// modules/SettingsManager.ts

import { GM_getValue, GM_setValue } from '$';
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
 *   4. Add a corresponding menu command in `SettingsMenu.ts`.
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
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

/**
 * Applied when no persisted value is found in GM storage.
 * Changing a default here only affects first-time users (or after storage is cleared).
 */
const DEFAULTS: FFNSettings = {
    docDownloadFormat: DocDownloadFormat.MARKDOWN,
    fluidMode: true,
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
 *   cache. `GM_getValue` is synchronous in Tampermonkey, so this is safe to
 *   call at `document-start`. Running in Phase 1 means settings are available
 *   to all downstream modules in both phases — including `LayoutManager.prime()`
 *   which needs `fluidMode` to prevent a Flash of Unstyled Content (FOUC).
 * - Phase 2 (`init`): No-op. Settings are already in cache.
 *
 * **Adding a new setting:** See `FFNSettings` interface above.
 *
 * **GOTCHA:** `GM_getValue` / `GM_setValue` are asynchronous in some non-TM
 * environments (e.g., Chrome MV3 extension runners). If you ever need to
 * support those, change `_loadAll()` and `set()` to return Promises and update
 * the callers accordingly.
 *
 * **GOTCHA:** Do NOT import SettingsManager from LayoutManager unless you have
 * verified the EarlyBoot registration order in `main.ts`. SettingsManager MUST
 * be registered before LayoutManager for `prime()` sequencing to work.
 */
export const SettingsManager: ISitewideModule & {
    get<K extends keyof FFNSettings>(key: K): FFNSettings[K];
    set<K extends keyof FFNSettings>(key: K, value: FFNSettings[K]): void;
} = {

    /**
     * ISitewideModule Phase 1 — document-start.
     * Loads all settings from GM storage before any module reads them.
     */
    prime(): void {
        _loadAll();
        FFNLogger.log(MODULE_NAME, 'prime', 'Settings loaded.');
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
     * Persists a setting to GM storage and updates the in-memory cache.
     * @param key - The setting key.
     * @param value - The new value.
     */
    set<K extends keyof FFNSettings>(key: K, value: FFNSettings[K]): void {
        _cache[key] = value;
        // GM_setValue only accepts string | number | boolean.
        // All FFNSettings values are one of those types.
        GM_setValue(STORAGE_PREFIX + key, value as string | number | boolean);
        FFNLogger.log(MODULE_NAME, 'set', `Saved: ${String(key)} = ${String(value)}`);
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
        // Validate that the stored string is a known DocDownloadFormat value
        // to guard against stale/corrupt storage entries.
        const knownFormats = Object.values(DocDownloadFormat) as string[];
        if (knownFormats.includes(storedFormat)) {
            _cache.docDownloadFormat = storedFormat as DocDownloadFormat;
        }
    }

    // fluidMode — stored as a boolean
    const storedFluid = GM_getValue(STORAGE_PREFIX + 'fluidMode') as boolean | undefined;
    if (storedFluid !== undefined) {
        _cache.fluidMode = Boolean(storedFluid); // coerce in case stored as 0/1
    }
}
