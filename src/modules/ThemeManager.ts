// modules/ThemeManager.ts

import { FFNLogger } from './FFNLogger';

// ─── Chrome Storage Interfaces ────────────────────────────────────────────────

/**
 * Minimal interface for the chrome.runtime object.
 * Declared locally to avoid a dependency on @types/chrome,
 * since this project targets Tampermonkey userscripts where the chrome
 * API is conditionally available (and not typed by any installed package).
 */
interface ChromeRuntime {
    lastError?: { message: string };
}

/**
 * Minimal interface for the chrome.storage.sync object.
 */
interface ChromeStorageSync {
    get(key: string, callback: (result: Record<string, unknown>) => void): void;
    set(items: Record<string, unknown>, callback?: () => void): void;
}

// ─── Module-level Constants ────────────────────────────────────────────────────

/**
 * Module name used for logging.
 */
const MODULE_NAME = 'ThemeManager';

/**
 * The ID used for the injected theme style tag to prevent duplicates.
 */
const STYLE_TAG_ID = 'ffn-enhancements-theme-styles';

/**
 * The localStorage key used to persist the active theme across page loads.
 * Read synchronously at prime()-time to eliminate FOUC.
 */
const STORAGE_KEY = 'ffn-enhancements-theme';

/**
 * The chrome.storage.sync key used for cross-device theme persistence.
 * Only accessed in init() — after DOMContentLoaded — since chrome.storage is async.
 */
const CHROME_STORAGE_KEY = 'ffnEnhancementsTheme';

/**
 * Registry of all available named themes.
 * Each key is a theme name; the value is the full CSS string for that theme.
 * Adding a new theme requires only a single entry here — no structural changes elsewhere.
 */
const THEMES: Record<string, string> = {

    dark: `
        /* --- FFN Enhancements: Dark Theme --- */
        /* Scope: Remaps FFN's light palette to a dark palette.
           Preserves brand colors: the green navigation bar,
           teal/green link accents, and the site logo are intentionally untouched. */

        /* 1. Page background and default text color */
        body {
            background-color: #1a1a1a !important;
            color: #d4d4d4 !important;
        }

        /* 2. Main content wrappers */
        #content_wrapper,
        #content_wrapper_inner {
            background-color: #1a1a1a !important;
        }

        /* 3. Story text reading area */
        .storytext,
        #storytext,
        #storytextp {
            background-color: #1e1e1e !important;
            color: #d4d4d4 !important;
        }

        /* 4. Story listing cards and profile panels */
        .z-list,
        .z-list-wrap,
        .z-padtop2,
        div.z-list {
            background-color: #242424 !important;
            border-color: #3a3a3a !important;
            color: #d4d4d4 !important;
        }

        /* 5. Inline story blurbs and metadata rows */
        .z-indent,
        .z-list .z-indent {
            background-color: #242424 !important;
            color: #b0b0b0 !important;
        }

        /* 6. General dividers, horizontal rules, and bordered containers */
        hr,
        .cco-div,
        .lc-left,
        .lc-right,
        .lc-wrapper,
        #filters,
        #filters_head,
        #storyinfo,
        #storytext_wrap,
        #profile_top,
        #bio,
        .tab-content,
        .module {
            background-color: #1e1e1e !important;
            border-color: #3a3a3a !important;
            color: #d4d4d4 !important;
        }

        /* 7. Chapter/pagination navigation rows */
        #chap_select,
        .lc-wrapper select,
        #nav_top,
        #nav_bottom,
        .chapter-text {
            background-color: #1a1a1a !important;
            border-color: #3a3a3a !important;
            color: #d4d4d4 !important;
        }

        /* 8. Select dropdowns and option elements */
        select,
        option {
            background-color: #2a2a2a !important;
            color: #d4d4d4 !important;
            border-color: #4a4a4a !important;
        }

        /* 9. Text inputs and textareas */
        input[type="text"],
        input[type="search"],
        input[type="email"],
        input[type="password"],
        input[type="number"],
        textarea {
            background-color: #2a2a2a !important;
            color: #d4d4d4 !important;
            border-color: #4a4a4a !important;
        }
        input[type="text"]::placeholder,
        input[type="search"]::placeholder,
        textarea::placeholder {
            color: #6a6a6a !important;
        }

        /* 10. Buttons (non-brand) */
        input[type="submit"],
        input[type="button"],
        button:not(.btn-success):not(.btn-primary) {
            background-color: #2e2e2e !important;
            color: #d4d4d4 !important;
            border-color: #4a4a4a !important;
        }

        /* 11. General headings */
        h1, h2, h3, h4, h5, h6 {
            color: #f0f0f0 !important;
        }

        /* 12. Quoted text / blockquotes in story chapters */
        blockquote {
            background-color: #252525 !important;
            border-left-color: #505050 !important;
            color: #c0c0c0 !important;
        }

        /* 13. Review and comment boxes */
        #review,
        #review_title,
        .review-reply {
            background-color: #1e1e1e !important;
            border-color: #3a3a3a !important;
            color: #d4d4d4 !important;
        }

        /* 14. Alert / notice bars (non-brand) */
        .alert.alert-info,
        .gui_note,
        .gui_warning {
            background-color: #252525 !important;
            border-color: #3a3a3a !important;
            color: #d4d4d4 !important;
        }

        /* 15. Modal dialogs */
        .modal-content,
        .modal-header,
        .modal-body,
        .modal-footer {
            background-color: #242424 !important;
            border-color: #3a3a3a !important;
            color: #d4d4d4 !important;
        }
        .modal-header {
            border-bottom-color: #3a3a3a !important;
        }
        .modal-footer {
            border-top-color: #3a3a3a !important;
        }

        /* 16. Tables used for stats, profile, and reviews */
        table,
        tr,
        td,
        th {
            background-color: transparent !important;
            border-color: #3a3a3a !important;
            color: #d4d4d4 !important;
        }
        tr:nth-child(even) td {
            background-color: #232323 !important;
        }

        /* 17. Secondary metadata text (grey in light mode) */
        .xgray,
        .gray,
        span.gray,
        .z-list span.gray {
            color: #888888 !important;
        }

        /* 18. Right-hand sidebar / widgets */
        #sidebar,
        .sidebar,
        .module .module-content {
            background-color: #1e1e1e !important;
            border-color: #3a3a3a !important;
            color: #d4d4d4 !important;
        }

        /* 19. Scrollbars (Chromium-based) */
        ::-webkit-scrollbar {
            background-color: #1a1a1a;
        }
        ::-webkit-scrollbar-thumb {
            background-color: #444444;
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background-color: #555555;
        }
    `,

    // future themes can be added here, e.g.:
    // sepia: `...`,
    // highContrast: `...`,

};

// ─── Module-level State ────────────────────────────────────────────────────────

/**
 * The name of the currently active theme.
 * Defaults to 'default' (no theme CSS injected).
 */
let _activeTheme = 'default';

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * ThemeManager
 * * Orchestrates visual theming for the application.
 * Implements FOUC-free dark mode as the first concrete theme in an extensible
 * theming system, using the same two-phase EarlyBoot bootstrapping contract as
 * LayoutManager.
 */
export const ThemeManager = {

    /**
     * ISitewideModule Phase 1 — document-start.
     * Reads the saved theme synchronously from localStorage and injects it
     * onto document.documentElement before the browser's first paint.
     * This eliminates FOUC: dark styles are in the DOM before any HTML is painted.
     *
     * Constraints: must remain fully synchronous.  No await, no setTimeout,
     * no chrome.storage calls — localStorage.getItem() is the only permitted
     * storage access at this phase.
     */
    prime(): void {
        const saved = _readStoredTheme();
        if (saved !== 'default') {
            _activeTheme = saved;
            _injectThemeStyles(saved);
        }
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded.
     * Reconciles the prime-phase localStorage value with chrome.storage.sync
     * to apply any cross-device preference changes made since the last load.
     * Also wires up toggle event listeners when a settings UI is present.
     */
    init(): void {
        _log('init', 'Starting init sequence...');
        _reconcileWithChromeStorage();
    },

    /**
     * Public API for the settings menu (and future UI) to switch themes.
     * Applies the new theme immediately, then writes both localStorage
     * (for next-load prime-time reads) and chrome.storage.sync (cross-device).
     * Logs a warning and does nothing for unknown theme names.
     * @param name - The theme name to activate, or 'default' to clear theming.
     */
    setTheme(name: string): void {
        if (name !== 'default' && !(name in THEMES)) {
            _log('setTheme', `Unknown theme: "${name}". Valid options: default, ${Object.keys(THEMES).join(', ')}.`);
            return;
        }
        _log('setTheme', `Applying theme: "${name}".`);
        _activeTheme = name;
        _applyTheme(name);
        _writeStoredTheme(name);
        _writeChromeStorage(name);
    },

    /**
     * Returns the name of the currently active theme.
     * @returns The active theme name, e.g. 'dark' or 'default'.
     */
    getTheme(): string {
        return _activeTheme;
    },

};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Internal helper to format logs consistently via the shared Logger.
 * @param funcName - The name of the function calling the log.
 * @param msg - The message to log.
 */
function _log(funcName: string, msg: string): void {
    FFNLogger.log(MODULE_NAME, funcName, msg);
}

/**
 * Reads the persisted theme name from localStorage.
 * Returns 'default' if nothing is stored or the stored value is unrecognised.
 */
function _readStoredTheme(): string {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && (stored === 'default' || stored in THEMES)) {
            return stored;
        }
    } catch (e) {
        // localStorage may be unavailable in some contexts; fail silently.
    }
    return 'default';
}

/**
 * Persists the active theme name to localStorage so that prime() can read it
 * on the next page load without any async overhead.
 * @param name - The theme name to store.
 */
function _writeStoredTheme(name: string): void {
    try {
        localStorage.setItem(STORAGE_KEY, name);
    } catch (e) {
        _log('writeStoredTheme', 'Failed to write theme to localStorage.');
    }
}

/**
 * Injects the CSS string for the given theme as a <style> tag.
 * Anchored to document.documentElement at prime()-time (document.head is not
 * yet guaranteed), and to document.head at init()-time or later.
 * No-ops if the style tag already exists (idempotent).
 * @param name - A key present in the THEMES registry.
 */
function _injectThemeStyles(name: string): void {
    if (document.getElementById(STYLE_TAG_ID)) {
        return; // Already injected
    }

    const css = THEMES[name];
    if (!css) {
        return;
    }

    const style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    style.textContent = css;

    if (document.head) {
        document.head.appendChild(style);
    } else {
        // document.head is not yet available at document-start; use <html> as anchor.
        document.documentElement.appendChild(style);
    }

    _log('injectThemeStyles', `Theme styles injected for "${name}".`);
}

/**
 * Removes the injected theme style tag from the DOM.
 * Called when reverting to 'default' (no theme).
 */
function _removeThemeStyles(): void {
    const existing = document.getElementById(STYLE_TAG_ID);
    if (existing) {
        existing.remove();
        _log('removeThemeStyles', 'Theme styles removed.');
    }
}

/**
 * Applies a theme by name, replacing any currently injected theme styles.
 * Pass 'default' to remove theming entirely.
 * @param name - The theme name to apply, or 'default' to clear.
 */
function _applyTheme(name: string): void {
    _removeThemeStyles();
    if (name !== 'default') {
        _injectThemeStyles(name);
    }
}

/**
 * Returns the chrome.storage.sync object if it is available in the current
 * runtime context (e.g. a Chrome extension), or null otherwise.
 *
 * Accessed via globalThis to avoid a direct reference to the untyped `chrome`
 * global, which is not present in Tampermonkey userscript environments and is
 * not declared in this project's tsconfig types.
 */
function _getChromeStorageSync(): ChromeStorageSync | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).chrome?.storage?.sync ?? null;
}

/**
 * Returns the chrome.runtime object if available, or null otherwise.
 */
function _getChromeRuntime(): ChromeRuntime | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).chrome?.runtime ?? null;
}

/**
 * Reconciles the prime-phase localStorage value with chrome.storage.sync.
 * If the synced preference differs from the locally stored one (e.g. the user
 * changed their theme on another device), re-applies the correct theme and
 * updates localStorage to match.
 */
function _reconcileWithChromeStorage(): void {
    const storageSync = _getChromeStorageSync();
    if (!storageSync) {
        _log('reconcileWithChromeStorage', 'chrome.storage.sync unavailable; skipping reconciliation.');
        return;
    }

    storageSync.get(CHROME_STORAGE_KEY, (result: Record<string, unknown>) => {
        const runtime = _getChromeRuntime();
        if (runtime?.lastError) {
            _log('reconcileWithChromeStorage', `chrome.storage.sync read error: ${runtime.lastError.message}`);
            return;
        }

        const syncedTheme = typeof result[CHROME_STORAGE_KEY] === 'string'
            ? (result[CHROME_STORAGE_KEY] as string)
            : 'default';

        if (syncedTheme !== _activeTheme) {
            _log('reconcileWithChromeStorage', `Synced theme "${syncedTheme}" differs from local "${_activeTheme}". Re-applying.`);
            _activeTheme = syncedTheme;
            _applyTheme(syncedTheme);
            _writeStoredTheme(syncedTheme);
        } else {
            _log('reconcileWithChromeStorage', `Theme "${_activeTheme}" is in sync.`);
        }
    });
}

/**
 * Persists the active theme name to chrome.storage.sync for cross-device sync.
 * Fire-and-forget; errors are logged but do not affect the active theme.
 * @param name - The theme name to store.
 */
function _writeChromeStorage(name: string): void {
    const storageSync = _getChromeStorageSync();
    if (!storageSync) {
        return;
    }

    storageSync.set({ [CHROME_STORAGE_KEY]: name }, () => {
        const runtime = _getChromeRuntime();
        if (runtime?.lastError) {
            _log('writeChromeStorage', `chrome.storage.sync write error: ${runtime.lastError.message}`);
        }
    });
}
