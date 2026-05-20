// modules/SettingsManager.ts

import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { Theme } from '../enums/Theme';
import { FFNLogger } from './FFNLogger';
import { ISitewideModule } from '../interfaces/ISiteWideModule';
import { platformStorage } from '../platform/storage';

// ─── Settings Schema ──────────────────────────────────────────────────────────

/**
 * All configurable settings for the extension.
 *
 * To add a new setting:
 *   1. Add the field here with its type.
 *   2. Add its default to `DEFAULTS` below.
 *   3. Add one-liner in `_loadAll()`: `_loadBool(key)` / `_loadEnum(key, EnumObj)` / `_loadPositiveNumber(key)`.
 *   4. Add a control row to `SettingsPage.ts`.
 */
export interface FFNSettings {
    /**
     * Format for downloading author-owned documents (Doc Manager / Doc Editor).
     * Does NOT affect story-page downloads (those are always via FicHub/Native).
     */
    docDownloadFormat: DocDownloadFormat;

    /**
     * Visual theme for FFN Enhancements UI and runtime FFN color remapping.
     * SYSTEM follows the browser/OS `prefers-color-scheme` value.
     */
    theme: Theme;

    /**
     * Whether to apply full-width ("Fluid") layout, removing FFN's fixed-width borders.
     * Mirrors AO3's reading experience.
     */
    fluidMode: boolean;

    /**
     * Whether to auto-convert Markdown text when pasted into the Doc Editor's TinyMCE iframe.
     * Detected via `SimpleMarkdownParser.isMarkdown()`.
     */
    pasteConvertMarkdown: boolean;

    /**
     * Whether to auto-convert HTML source text when pasted into the Doc Editor's TinyMCE iframe.
     * Detected by the presence of block-level HTML tags in the pasted plain text.
     */
    pasteConvertHtml: boolean;

    /**
     * When false (default), pastes that carry a `text/html` MIME type in the clipboard
     * (e.g. from Word, Google Docs, or a browser copy) are skipped — TinyMCE's native
     * paste handler already renders them as rich text.
     * When true, Markdown/HTML source detection runs regardless of clipboard MIME types.
     */
    pasteForceIntercept: boolean;

    /**
     * When true (default), converts inline `style="text-align:*"` attributes to
     * `align="*"` attributes in HTML exports. Ao3's TinyMCE rejects the style
     * attribute but accepts the align attribute.
     */
    ao3HtmlCompatibility: boolean;

    /**
     * When true (default), flattens multi-line text inside exported HTML paragraph
     * tags to single lines and inserts a blank line between adjacent paragraphs.
     */
    normalizeHtmlParagraphs: boolean;

    /**
     * When true, appends a format-specific separator at the end of exported
     * content: `---` for Markdown, `HR tag` for HTML/DOCX.
     */
    appendSeparator: boolean;

    /**
     * When true, Bulk Replace auto-maps nearby numbered docs after a manual
     * source-doc selection.
     */
    bulkReplaceAutofill: boolean;

    /**
     * Number of pixels to scroll per W/S/↑/↓ keypress on story reading pages.
     */
    scrollStep: number;

    /**
     * Maximum retry attempts for failed document fetch operations in `DocFetchService._fetchDocPage`
     * and `DocFetchService.refreshPrivateDoc`.
     */
    fetchMaxRetries: number;

    /**
     * Base backoff duration between fetch retry attempts (ms).
     * Actual delay = attempt × fetchRetryBaseMs (e.g. 2s, 4s, 6s at base=2000).
     */
    fetchRetryBaseMs: number;

    /**
     * Maximum time to wait for a hidden iframe to reach `readyState=complete`
     * during document refresh (ms). Increase if docs fail to refresh on slow connections.
     */
    iframeLoadTimeoutMs: number;

    /**
     * Maximum time to wait for the save confirmation panel to appear after clicking
     * the Save button in the hidden iframe (ms).
     */
    iframeSaveTimeoutMs: number;

    /**
     * Delay between consecutive document requests during Pass 1 of bulk export/refresh (ms).
     * Increase if you encounter FFN rate-limiting errors.
     */
    bulkExportDelayMs: number;

    /**
     * Cool-down period inserted between Pass 1 and the Pass 2 retry loop during
     * bulk operations (ms). Lets FFN servers breathe after a full pass.
     */
    bulkCooldownMs: number;

    /**
     * Delay between consecutive document requests during Pass 2 (retry pass) of
     * bulk export/refresh (ms). Longer than Pass 1 to be gentle on retries.
     */
    bulkRetryDelayMs: number;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

/**
 * Applied when no persisted value is found in storage.
 * Changing a default here only affects first-time users (or after storage is cleared).
 */
const DEFAULTS: FFNSettings = {
    docDownloadFormat: DocDownloadFormat.MARKDOWN,
    theme: Theme.SYSTEM,
    fluidMode: true,
    pasteConvertMarkdown: true,
    pasteConvertHtml: true,
    pasteForceIntercept: false,
    ao3HtmlCompatibility: true,
    normalizeHtmlParagraphs: true,
    appendSeparator: false,
    bulkReplaceAutofill: true,
    scrollStep: 300,
    fetchMaxRetries: 3,
    fetchRetryBaseMs: 2000,
    iframeLoadTimeoutMs: 30000,
    iframeSaveTimeoutMs: 10000,
    bulkExportDelayMs: 1000,
    bulkCooldownMs: 5000,
    bulkRetryDelayMs: 3000,
};

/**
 * Registry of enum-backed settings for validation in _parseStoredValue.
 * Maps setting key → enum object. Add new enum settings here.
 */
const ENUM_SETTINGS: Partial<Record<keyof FFNSettings, Record<string, string>>> = {
    docDownloadFormat: DocDownloadFormat,
    theme: Theme,
};

// ─── Internal State ───────────────────────────────────────────────────────────

const MODULE_NAME = 'SettingsManager';

/**
 * In-memory cache. Populated by `_loadAll()` during prime().
 * All reads happen against this cache — never directly against storage —
 * so they are synchronous and allocation-free.
 */
let _cache: FFNSettings = { ...DEFAULTS };

/**
 * Internal pub-sub registry for `subscribe()`.
 * Key = setting key string. Value = Set of raw callbacks.
 */
const _subscribers = new Map<string, Set<(newVal: unknown, oldVal: unknown) => void>>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * SettingsManager
 * Central registry for all persistent extension settings.
 *
 * Uses `chrome.storage.local` for cross-session persistence + cross-tab sync
 * and `localStorage` for synchronous document-start reads.
 *
 * **Execution model:**
 * - Phase 1 (`prime`): Loads all settings from localStorage into the in-memory
 *   cache and registers `chrome.storage.onChanged` for cross-tab sync.
 * - Phase 2 (`init`): No-op. Settings are already in cache.
 *
 * **Cross-tab sync:**
 * `chrome.storage.onChanged` fires when another tab changes a storage value.
 * The listener updates the in-memory cache and notifies all `subscribe()` callbacks.
 * Same-tab changes made via `set()` are guarded with a timestamp window in
 * `platformStorage` so subscribers are not double-notified.
 *
 * **Adding a new setting:** See `FFNSettings` interface above.
 */
export const SettingsManager: ISitewideModule & {
    get<K extends keyof FFNSettings>(key: K): FFNSettings[K];
    set<K extends keyof FFNSettings>(key: K, value: FFNSettings[K]): Promise<void>;
    subscribe<K extends keyof FFNSettings>(
        key: K,
        cb: (newVal: FFNSettings[K], oldVal: FFNSettings[K]) => void
    ): () => void;
} = {

    /**
     * ISitewideModule Phase 1 — document-start.
     * Loads all settings from localStorage and arms cross-tab value listeners.
     */
    prime(): void {
        _loadAll();
        _mirrorThemeCache(_cache.theme);
        _registerOnChangedListener();
        void _hydrateFromPersistentStorage();
        FFNLogger.log(MODULE_NAME, 'prime', 'Settings loaded; cross-tab listener registered.');
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded. No-op.
     * Settings are already in the in-memory cache from prime().
     */
    init(): void { /* no-op — already loaded in prime() */ },

    /**
     * Reads a setting from the in-memory cache (synchronous).
     * @param key - The setting key.
     * @returns The current value (from storage or the default).
     */
    get<K extends keyof FFNSettings>(key: K): FFNSettings[K] {
        return _cache[key];
    },

    /**
     * Persists a setting to storage, updates the in-memory cache, and
     * notifies all local subscribers.
     *
     * The write to localStorage is synchronous (immediate reads).
     * The write to chrome.storage.local is async (persistence + cross-tab sync).
     *
     * @param key - The setting key.
     * @param value - The new value.
     */
    async set<K extends keyof FFNSettings>(key: K, value: FFNSettings[K]): Promise<void> {
        const old = _cache[key];
        _cache[key] = value;
        // platformStorage.set() writes to localStorage (sync) + chrome.storage (async).
        await platformStorage.set(key, value as string | number | boolean);
        if (key === 'theme') {
            _mirrorThemeCache(_parseStoredValue('theme', value));
        }
        _notifySubscribers(key, value, old);
        FFNLogger.log(MODULE_NAME, 'set', `Saved: ${String(key)} = ${String(value)}`);
    },

    /**
     * Subscribes to changes for a specific setting key.
     *
     * Fires for:
     * - Local changes made via `set()` (same tab)
     * - Remote changes made in any other tab (via `chrome.storage.onChanged`)
     *
     * @param key - The setting key to watch.
     * @param cb - Callback receiving the new value and the previous value.
     * @returns An unsubscribe function. Call it to remove the listener.
     */
    subscribe<K extends keyof FFNSettings>(
        key: K,
        cb: (newVal: FFNSettings[K], oldVal: FFNSettings[K]) => void
    ): () => void {
        const k = String(key);
        if (!_subscribers.has(k)) {
            _subscribers.set(k, new Set());
        }
        const raw = cb as (newVal: unknown, oldVal: unknown) => void;
        _subscribers.get(k)!.add(raw);
        return () => { _subscribers.get(k)?.delete(raw); };
    },

};

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Reads every known setting from localStorage into the in-memory cache.
 * Falls back to `DEFAULTS` for any key not found in storage.
 */
function _loadAll(): void {
    _cache = { ...DEFAULTS };
    _loadEnum('docDownloadFormat', DocDownloadFormat);
    _loadEnum('theme', Theme);
    _loadBool('fluidMode');
    _loadBool('pasteConvertMarkdown');
    _loadBool('pasteConvertHtml');
    _loadBool('pasteForceIntercept');
    _loadBool('ao3HtmlCompatibility');
    _loadBool('normalizeHtmlParagraphs');
    _loadBool('appendSeparator');
    _loadBool('bulkReplaceAutofill');
    _loadPositiveNumber('scrollStep');
    _loadPositiveNumber('fetchMaxRetries');
    _loadPositiveNumber('fetchRetryBaseMs');
    _loadPositiveNumber('iframeLoadTimeoutMs');
    _loadPositiveNumber('iframeSaveTimeoutMs');
    _loadPositiveNumber('bulkExportDelayMs');
    _loadPositiveNumber('bulkCooldownMs');
    _loadPositiveNumber('bulkRetryDelayMs');
}

function _loadPositiveNumber(key: keyof FFNSettings): void {
    const stored = platformStorage.get(key);
    if (stored !== null && typeof stored === 'number') {
        const n = Number(stored);
        if (Number.isFinite(n) && n > 0) {
            (_cache as unknown as Record<string, unknown>)[key] = n;
        }
    }
}

function _loadBool(key: keyof FFNSettings): void {
    const stored = platformStorage.get(key);
    const parsed = _parseStoredValue(key, stored);
    if (parsed !== undefined) {
        (_cache as unknown as Record<string, unknown>)[key] = parsed;
    }
}

function _loadEnum(key: keyof FFNSettings, enumObj: Record<string, string>): void {
    const stored = platformStorage.get(key);
    if (stored !== null && typeof stored === 'string') {
        const known = Object.values(enumObj) as string[];
        if (known.includes(stored)) {
            (_cache as unknown as Record<string, unknown>)[key] = stored;
        }
    }
}

/**
 * Registers a single chrome.storage.onChanged listener for cross-tab sync.
 * Replaces the old per-key value-change listener approach.
 *
 * The local-write guard in platformStorage prevents double-firing for
 * changes made by this tab's own set() calls.
 */
function _registerOnChangedListener(): void {
    try {
        platformStorage.onChanged((key, newRaw, _oldRaw) => {
            const parsed = _parseStoredValue(key as keyof FFNSettings, newRaw);
            if (parsed !== undefined) {
                _applyParsedSetting(key as keyof FFNSettings, parsed);
            }
        });
    } catch {
        FFNLogger.log(MODULE_NAME, '_registerOnChangedListener',
            'chrome.storage.onChanged unavailable. Cross-tab sync disabled.');
    }
}

async function _hydrateFromPersistentStorage(): Promise<void> {
    try {
        const hydrated = await platformStorage.hydrateFromPersistentStorage();
        for (const [key, raw] of Object.entries(hydrated)) {
            const parsed = _parseStoredValue(key as keyof FFNSettings, raw);
            if (parsed !== undefined) {
                _applyParsedSetting(key as keyof FFNSettings, parsed);
            }
        }
    } catch {
        FFNLogger.log(MODULE_NAME, '_hydrateFromPersistentStorage',
            'chrome.storage.local hydration unavailable. Using local mirror only.');
    }
}

function _applyParsedSetting<K extends keyof FFNSettings>(key: K, value: FFNSettings[K]): void {
    const old = _cache[key];
    if (old === value) return;

    _cache[key] = value;
    if (key === 'theme') {
        _mirrorThemeCache(value as Theme);
    }
    _notifySubscribers(key, value, old);
}

/**
 * Parses a raw value from storage into the correct typed FFNSettings value.
 * Returns `undefined` if the raw value is invalid or corrupt.
 *
 * Handles both:
 * - localStorage strings (JSON-encoded or raw)
 * - chrome.storage native types (boolean, number)
 */
export function _parseStoredValue<K extends keyof FFNSettings>(key: K, raw: unknown): FFNSettings[K] | undefined {
    const defaultVal = DEFAULTS[key];

    if (typeof defaultVal === 'boolean') {
        if (typeof raw === 'boolean') return raw as FFNSettings[K];
        if (raw === 'true') return true as FFNSettings[K];
        if (raw === 'false') return false as FFNSettings[K];
        return undefined;
    }

    if (typeof defaultVal === 'number') {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n as FFNSettings[K];
        return undefined;
    }

    if (typeof defaultVal === 'string') {
        const enumMap = ENUM_SETTINGS[key];
        if (enumMap) {
            const known = Object.values(enumMap) as string[];
            if (known.includes(String(raw))) return raw as FFNSettings[K];
            return undefined;
        }
        return String(raw) as FFNSettings[K];
    }

    return undefined;
}

/**
 * Mirrors the validated theme into localStorage so the prelude can read it
 * synchronously at document-start (before SettingsManager.prime() runs).
 */
function _mirrorThemeCache(theme: Theme | undefined): void {
    if (theme === undefined) return;
    try {
        window.localStorage.setItem('ffne_theme_cache', theme);
    } catch {
        // localStorage unavailable — non-fatal.
    }
}

/**
 * Calls all registered subscribers for `key` with the new and old values.
 * Errors in individual subscribers are caught and logged.
 */
function _notifySubscribers<K extends keyof FFNSettings>(
    key: K,
    newVal: FFNSettings[K],
    oldVal: FFNSettings[K]
): void {
    const subs = _subscribers.get(String(key));
    if (!subs) return;
    subs.forEach(cb => {
        try {
            cb(newVal, oldVal);
        } catch (e) {
            FFNLogger.log(MODULE_NAME, '_notifySubscribers',
                `Subscriber threw for "${String(key)}":`, e as object);
        }
    });
}
