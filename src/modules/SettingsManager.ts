// modules/SettingsManager.ts

import { GM_getValue, GM_setValue, GM_addValueChangeListener } from '$';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { FFNLogger } from './FFNLogger';
import { ISitewideModule } from '../interfaces/ISiteWideModule';

// ─── Settings Schema ──────────────────────────────────────────────────────────

/**
 * All configurable settings for the extension.
 *
 * To add a new setting:
 *   1. Add the field here with its type.
 *   2. Add its default to `DEFAULTS` below.
 *   3. Add an explicit load line in `_loadAll()`.
 *   4. Add a GM_addValueChangeListener entry in `_registerValueListeners()`.
 *   5. Add a control row to `SettingsPage.ts`.
 */
export interface FFNSettings {
    /**
     * Format for downloading author-owned documents (Doc Manager / Doc Editor).
     * Does NOT affect story-page downloads (those are always via FicHub/Native).
     */
    docDownloadFormat: DocDownloadFormat;

    /**
     * Whether to apply full-width ("Fluid") layout, removing FFN's fixed-width borders.
     * Mirrors AO3's reading experience.
     */
    fluidMode: boolean;

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
 * Applied when no persisted value is found in GM storage.
 * Changing a default here only affects first-time users (or after storage is cleared).
 */
const DEFAULTS: FFNSettings = {
    docDownloadFormat: DocDownloadFormat.MARKDOWN,
    fluidMode: true,
    scrollStep: 300,
    fetchMaxRetries: 3,
    fetchRetryBaseMs: 2000,
    iframeLoadTimeoutMs: 30000,
    iframeSaveTimeoutMs: 10000,
    bulkExportDelayMs: 1000,
    bulkCooldownMs: 5000,
    bulkRetryDelayMs: 3000,
};

// ─── Internal State ───────────────────────────────────────────────────────────

/**
 * Prefix applied to all GM storage keys to avoid collisions with other userscripts.
 */
const STORAGE_PREFIX = 'ffne_';

const MODULE_NAME = 'SettingsManager';

/**
 * In-memory cache. Populated by `_loadAll()` during prime().
 * All reads happen against this cache — never directly against GM storage —
 * so they are synchronous and allocation-free.
 */
let _cache: FFNSettings = { ...DEFAULTS };

/**
 * Internal pub-sub registry for `subscribe()`.
 * Key = setting key string. Value = Set of raw callbacks typed as (unknown, unknown) => void.
 * Type safety is enforced in the public `subscribe()` API; internals use unknown.
 */
const _subscribers = new Map<string, Set<(newVal: unknown, oldVal: unknown) => void>>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * SettingsManager
 * Central registry for all persistent extension settings.
 *
 * Uses `GM_getValue` / `GM_setValue` for cross-session persistence.
 * Tampermonkey's own storage survives browser restarts, is isolated to
 * this userscript, and participates in TM's built-in backup/export flow.
 *
 * **Execution model:**
 * - Phase 1 (`prime`): Loads all settings from GM storage into the in-memory
 *   cache and registers `GM_addValueChangeListener` entries for cross-tab sync.
 *   `GM_getValue` is synchronous in Tampermonkey, so this is safe to call at
 *   `document-start`. Running in Phase 1 means settings are available to ALL
 *   modules in both phases — including `LayoutManager.prime()` which needs
 *   `fluidMode` to prevent a Flash of Unstyled Content (FOUC).
 * - Phase 2 (`init`): No-op. Settings are already in cache.
 *
 * **Cross-tab sync:**
 * `GM_addValueChangeListener` fires when another tab changes a GM storage value.
 * The listener updates the in-memory cache and notifies all `subscribe()` callbacks.
 * Same-tab changes made via `set()` skip the listener (remote=false guard) because
 * `set()` already updates the cache and calls subscribers directly.
 *
 * **Adding a new setting:** See `FFNSettings` interface above.
 *
 * **GOTCHA:** `GM_getValue` / `GM_setValue` are asynchronous in some non-TM
 * environments (e.g., Chrome MV3 extension runners). If you ever need to
 * support those, change `_loadAll()` and `set()` to return Promises and update
 * the callers accordingly.
 *
 * **GOTCHA:** `GM_addValueChangeListener` may also fire for same-tab changes
 * (remote=false) in some TM builds. The `!remote` guard in `_registerValueListeners`
 * prevents double-applying.
 *
 * **GOTCHA:** Do NOT import SettingsManager from LayoutManager unless you have
 * verified the EarlyBoot registration order in `main.ts`. SettingsManager MUST
 * be registered before LayoutManager for `prime()` sequencing to work.
 */
export const SettingsManager: ISitewideModule & {
    get<K extends keyof FFNSettings>(key: K): FFNSettings[K];
    set<K extends keyof FFNSettings>(key: K, value: FFNSettings[K]): void;
    subscribe<K extends keyof FFNSettings>(
        key: K,
        cb: (newVal: FFNSettings[K], oldVal: FFNSettings[K]) => void
    ): () => void;
} = {

    /**
     * ISitewideModule Phase 1 — document-start.
     * Loads all settings from GM storage and arms cross-tab value listeners.
     */
    prime(): void {
        _loadAll();
        _registerValueListeners();
        FFNLogger.log(MODULE_NAME, 'prime', 'Settings loaded; cross-tab listeners registered.');
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded. No-op.
     * Settings are already in the in-memory cache from prime().
     */
    init(): void { /* no-op — already loaded in prime() */ },

    /**
     * Reads a setting from the in-memory cache (synchronous).
     * @param key - The setting key.
     * @returns The current value (from GM storage or the default).
     */
    get<K extends keyof FFNSettings>(key: K): FFNSettings[K] {
        return _cache[key];
    },

    /**
     * Persists a setting to GM storage, updates the in-memory cache, and
     * notifies all local subscribers.
     * @param key - The setting key.
     * @param value - The new value.
     */
    set<K extends keyof FFNSettings>(key: K, value: FFNSettings[K]): void {
        const old = _cache[key];
        _cache[key] = value;
        // GM_setValue only accepts string | number | boolean.
        // All FFNSettings values are one of those types.
        GM_setValue(STORAGE_PREFIX + key, value as string | number | boolean);
        _notifySubscribers(key, value, old);
        FFNLogger.log(MODULE_NAME, 'set', `Saved: ${String(key)} = ${String(value)}`);
    },

    /**
     * Subscribes to changes for a specific setting key.
     *
     * Fires for:
     * - Local changes made via `set()` (same tab)
     * - Remote changes made in any other tab (via `GM_addValueChangeListener`)
     *
     * @param key - The setting key to watch.
     * @param cb - Callback receiving the new value and the previous value.
     * @returns An unsubscribe function. Call it to remove the listener.
     *
     * @example
     * const unsub = SettingsManager.subscribe('fluidMode', (newVal) => {
     *     LayoutManager.setFluidMode(newVal);
     * });
     * // Later: unsub(); // remove listener
     */
    subscribe<K extends keyof FFNSettings>(
        key: K,
        cb: (newVal: FFNSettings[K], oldVal: FFNSettings[K]) => void
    ): () => void {
        const k = String(key);
        if (!_subscribers.has(k)) {
            _subscribers.set(k, new Set());
        }
        // Internal storage uses unknown; type safety enforced by the generic signature above.
        const raw = cb as (newVal: unknown, oldVal: unknown) => void;
        _subscribers.get(k)!.add(raw);
        return () => { _subscribers.get(k)?.delete(raw); };
    },

};

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Reads every known setting from GM storage into the in-memory cache.
 * Falls back to `DEFAULTS` for any key not found in storage.
 *
 * NOTE: Each key must be listed explicitly so TypeScript can verify the
 * assignment types. Using `Object.keys(DEFAULTS)` with a generic cast works
 * but loses type safety — prefer explicit assignments when adding new settings.
 */
function _loadAll(): void {
    // docDownloadFormat — stored as a string (DocDownloadFormat enum value)
    const storedFormat = GM_getValue(STORAGE_PREFIX + 'docDownloadFormat') as string | undefined;
    if (storedFormat !== undefined) {
        const knownFormats = Object.values(DocDownloadFormat) as string[];
        if (knownFormats.includes(storedFormat)) {
            _cache.docDownloadFormat = storedFormat as DocDownloadFormat;
        }
    }

    // fluidMode — stored as a boolean
    const storedFluid = GM_getValue(STORAGE_PREFIX + 'fluidMode') as boolean | undefined;
    if (storedFluid !== undefined) {
        _cache.fluidMode = Boolean(storedFluid);
    }

    // Numeric settings — positive finite numbers only
    _loadPositiveNumber('scrollStep');
    _loadPositiveNumber('fetchMaxRetries');
    _loadPositiveNumber('fetchRetryBaseMs');
    _loadPositiveNumber('iframeLoadTimeoutMs');
    _loadPositiveNumber('iframeSaveTimeoutMs');
    _loadPositiveNumber('bulkExportDelayMs');
    _loadPositiveNumber('bulkCooldownMs');
    _loadPositiveNumber('bulkRetryDelayMs');
}

/**
 * Loads a single numeric setting from GM storage into the cache.
 * Only keys whose FFNSettings value type is `number` should be passed here.
 * The cast is safe because we only call this for known numeric fields.
 */
function _loadPositiveNumber(key: keyof FFNSettings): void {
    const stored = GM_getValue(STORAGE_PREFIX + key) as number | undefined;
    if (stored !== undefined) {
        const n = Number(stored);
        if (Number.isFinite(n) && n > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (_cache as Record<string, any>)[key] = n;
        }
    }
}

/**
 * Registers `GM_addValueChangeListener` for every setting key so changes
 * made in other browser tabs are reflected in this tab's in-memory cache
 * and propagated to all `subscribe()` listeners.
 *
 * GOTCHA: In some TM versions the listener fires for same-tab changes too
 * (remote=false). We guard against this with `if (!remote) return` to avoid
 * double-applying updates already handled by `set()`.
 */
function _registerValueListeners(): void {
    (Object.keys(DEFAULTS) as (keyof FFNSettings)[]).forEach(key => {
        try {
            GM_addValueChangeListener(
                STORAGE_PREFIX + key,
                (_name: string, _oldRaw: unknown, newRaw: unknown, remote?: boolean) => {
                    if (!remote) return; // already handled synchronously by set()
                    const parsed = _parseStoredValue(key, newRaw);
                    if (parsed !== undefined) {
                        const old = _cache[key];
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (_cache as Record<string, any>)[key] = parsed;
                        _notifySubscribers(key, parsed as FFNSettings[typeof key], old);
                    }
                }
            );
        } catch {
            // GM_addValueChangeListener unavailable in this environment.
            // Cross-tab sync is disabled; local settings changes still work normally.
            FFNLogger.log(MODULE_NAME, '_registerValueListeners',
                `GM_addValueChangeListener unavailable for "${String(key)}". Cross-tab sync disabled.`);
        }
    });
}

/**
 * Parses a raw value from GM storage (received via GM_addValueChangeListener)
 * into the correct typed FFNSettings value.
 * Returns `undefined` if the raw value is invalid or corrupt.
 */
function _parseStoredValue<K extends keyof FFNSettings>(key: K, raw: unknown): FFNSettings[K] | undefined {
    const defaultVal = DEFAULTS[key];

    if (typeof defaultVal === 'boolean') {
        return Boolean(raw) as FFNSettings[K];
    }

    if (typeof defaultVal === 'number') {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n as FFNSettings[K];
        return undefined;
    }

    if (typeof defaultVal === 'string') {
        // Validate enum values to guard against stale/corrupt storage entries.
        if (key === 'docDownloadFormat') {
            const known = Object.values(DocDownloadFormat) as string[];
            if (known.includes(String(raw))) return raw as FFNSettings[K];
            return undefined;
        }
        return String(raw) as FFNSettings[K];
    }

    return undefined;
}

/**
 * Calls all registered subscribers for `key` with the new and old values.
 * Errors in individual subscribers are caught and logged to prevent one
 * misbehaving subscriber from blocking others.
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

