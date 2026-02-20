// modules/ThemeManager.ts

import { FFNLogger } from './FFNLogger';
import { THEMES } from '../themes';
import type { ITheme } from '../interfaces/ITheme';

// ─── Module-level Constants ────────────────────────────────────────────────────

/**
 * Module name used for logging.
 */
const MODULE_NAME = 'ThemeManager';

/**
 * The CSS class applied to <body> when a theme is active.
 * All structural CSS rules are scoped under this class, preventing
 * theme styles from leaking to the 'default' (no-theme) state.
 */
const THEME_CLASS = 'ffn-theme';

/**
 * ID of the injected <style> tag that holds the structural CSS rules.
 * Contains all selector-to-var() mappings. Injected once at prime()-time
 * and never replaced; inert until THEME_CLASS is applied to <body>.
 */
const STRUCTURAL_STYLE_TAG_ID = 'ffn-enhancements-theme-structural';

/**
 * ID of the injected <style> tag that holds CSS custom property values
 * for the active theme.  Replaced (textContent swap) when the theme changes;
 * removed entirely when reverting to 'default'.
 */
const VARIABLE_STYLE_TAG_ID = 'ffn-enhancements-theme-variables';

/**
 * The localStorage key used to persist an explicit user theme preference.
 * Read synchronously at prime()-time to prevent FOUC.
 * A stored value of null means "no explicit preference — follow the system".
 * A stored value of 'default' means "user has explicitly opted out of theming".
 */
const STORAGE_KEY = 'ffn-enhancements-theme';

/**
 * The GM storage key used for persistent theme preference across browser sessions.
 * Accessed via GM_getValue/GM_setValue in init(), not at prime()-time.
 */
const GM_STORAGE_KEY = 'ffnEnhancementsTheme';

/**
 * DEBUG/TEST: Force dark mode unconditionally, bypassing all storage and
 * preference logic in prime().
 * Set to true to verify that the CSS injection strategy (structural CSS +
 * variable block + THEME_CLASS on body) works as intended, independently of
 * the localStorage / prefers-color-scheme resolution path.
 * Must be false in production.
 */
const FORCE_DARK_MODE = false;

/**
 * Full structural CSS for all themes.
 * Every color value is a CSS custom property (var(--ffn-*)) so that switching
 * themes at runtime requires only replacing the variable block — these rules
 * never change.  All selectors are scoped under body.${THEME_CLASS} to prevent
 * any leakage when no theme is active.
 *
 * Selector inventory is compiled from the codebase's delegate system and
 * cross-referenced against FFN's live DOM structure.
 *
 * PRESERVED (intentionally not targeted):
 *   #top               — the green branded navigation bar.
 *   img, canvas        — images must never be darkened.
 *   FFN link colors    — teal/green accents are part of FFN's navigational language.
 */
const STRUCTURAL_CSS = `
    /* --- FFN Enhancements: Theme Structural Rules ---
       All color values are CSS custom properties (var(--ffn-*)).
       These rules are written once and apply to every theme.
       Scoped under body.${THEME_CLASS} — inert when no theme is active. */

    /* ── 1. Layout shell ─────────────────────────────────────────────────── */

    /* body: base background and text. Highest-leverage target.
       FFN hardcodes background-color: white inline on some page types. */
    body.${THEME_CLASS} {
        background-color: var(--ffn-bg-primary) !important;
        color: var(--ffn-text-primary) !important;
    }

    body.${THEME_CLASS} #content_wrapper,
    body.${THEME_CLASS} #content_wrapper_inner {
        background-color: var(--ffn-bg-primary) !important;
    }

    /* .z-top-container: top bar housing the site logo and login/account links.
       Do NOT target child #top — that is the green branded navigation bar. */
    body.${THEME_CLASS} .z-top-container {
        background-color: var(--ffn-bg-nav) !important;
    }

    /* .menulink: horizontal nav bars (Browse, Communities, Forums).
       #zmenu: secondary author tools bar (visible when logged in).
       Both are structural chrome, not brand elements — safe to remap. */
    body.${THEME_CLASS} .menulink,
    body.${THEME_CLASS} #zmenu {
        background-color: var(--ffn-bg-nav) !important;
    }

    /* Reset the #zmenu inner table so it does not double-apply backgrounds. */
    body.${THEME_CLASS} #zmenu table {
        background-color: transparent !important;
    }

    /* ── 2. Semantic color classes — highest-leverage selectors ──────────── */

    /* .xcontrast_txt: applied by FFN to titles, author names, story summaries,
       chapter navigation labels, and the story text container itself.
       Setting a dark color here has the broadest single reach across all pages. */
    body.${THEME_CLASS} .xcontrast_txt {
        color: var(--ffn-text-primary) !important;
    }

    /* .xgray / .gray: secondary/muted text — metadata, stats, timestamps.
       Must be lighter than the primary text value but still subordinate. */
    body.${THEME_CLASS} .xgray,
    body.${THEME_CLASS} .gray,
    body.${THEME_CLASS} span.gray {
        color: var(--ffn-text-secondary) !important;
    }

    /* ── 3. Story page — header block (/s/*) ─────────────────────────────── */

    /* #profile_top: story title, author, cover art, summary, metadata.
       The cover image (img.cimage) must not be touched — handled by specificity. */
    body.${THEME_CLASS} #profile_top {
        background-color: var(--ffn-bg-secondary) !important;
        border-color: var(--ffn-border-primary) !important;
    }

    /* ── 4. Story page — reading surface ─────────────────────────────────── */

    /* #storytext / .storytext: the primary reading surface.
       Most critical target for readability — explicit background + text. */
    body.${THEME_CLASS} #storytext,
    body.${THEME_CLASS} .storytext,
    body.${THEME_CLASS} #storytextp,
    body.${THEME_CLASS} .storytextp {
        background-color: var(--ffn-bg-secondary) !important;
        color: var(--ffn-text-primary) !important;
    }

    body.${THEME_CLASS} blockquote {
        background-color: var(--ffn-bg-secondary) !important;
        border-left-color: var(--ffn-border-primary) !important;
        color: var(--ffn-text-primary) !important;
    }

    /* ── 5. Story page — chapter navigation ──────────────────────────────── */

    /* #chap_select: platform-native <select>; needs explicit override
       to prevent a white dropdown appearing over a dark page. */
    body.${THEME_CLASS} #chap_select,
    body.${THEME_CLASS} #nav_top,
    body.${THEME_CLASS} #nav_bottom {
        background-color: var(--ffn-bg-primary) !important;
        color: var(--ffn-text-primary) !important;
        border-color: var(--ffn-border-primary) !important;
    }

    /* ── 6. Browse and listing pages ─────────────────────────────────────── */

    /* .lc-wrapper, .lc, .lc-right: story card containers on browse pages. */
    body.${THEME_CLASS} .lc-wrapper,
    body.${THEME_CLASS} .lc,
    body.${THEME_CLASS} .lc-right {
        background-color: var(--ffn-bg-secondary) !important;
        border-color: var(--ffn-border-primary) !important;
        color: var(--ffn-text-primary) !important;
    }

    /* .lc-left: holds cover thumbnail — remap container bg only, never the img. */
    body.${THEME_CLASS} .lc-left {
        background-color: var(--ffn-bg-secondary) !important;
    }

    /* .z-list: older-style browse and search result listing rows. */
    body.${THEME_CLASS} .z-list,
    body.${THEME_CLASS} div.z-list,
    body.${THEME_CLASS} .z-list-wrap,
    body.${THEME_CLASS} .z-padtop2 {
        background-color: var(--ffn-bg-secondary) !important;
        border-color: var(--ffn-border-primary) !important;
        color: var(--ffn-text-primary) !important;
    }

    body.${THEME_CLASS} .z-indent,
    body.${THEME_CLASS} .z-list .z-indent {
        background-color: var(--ffn-bg-secondary) !important;
        color: var(--ffn-text-secondary) !important;
    }

    /* ── 7. Form inputs (sitewide) ───────────────────────────────────────── */

    /* Blanket dark remap of all three element types.
       Does not conflict with FFN's own CSS; confirmed by community dark themes. */
    body.${THEME_CLASS} input,
    body.${THEME_CLASS} select,
    body.${THEME_CLASS} textarea {
        background-color: var(--ffn-bg-input) !important;
        color: var(--ffn-text-input) !important;
        border-color: var(--ffn-border-primary) !important;
    }

    body.${THEME_CLASS} option {
        background-color: var(--ffn-bg-input) !important;
        color: var(--ffn-text-input) !important;
    }

    body.${THEME_CLASS} input::placeholder,
    body.${THEME_CLASS} textarea::placeholder {
        color: var(--ffn-text-secondary) !important;
        opacity: 0.7 !important;
    }

    /* ── 8. Buttons ──────────────────────────────────────────────────────── */

    /* button.btn: FFN's generic button class — Follow, Fav, chapter nav,
       and the Download button injected by this extension. */
    body.${THEME_CLASS} button.btn,
    body.${THEME_CLASS} input[type="submit"],
    body.${THEME_CLASS} input[type="button"] {
        background-color: var(--ffn-bg-input) !important;
        color: var(--ffn-text-primary) !important;
        border-color: var(--ffn-border-primary) !important;
    }

    /* ── 9. General sitewide chrome ──────────────────────────────────────── */

    body.${THEME_CLASS} #bio,
    body.${THEME_CLASS} #filters,
    body.${THEME_CLASS} #filters_head,
    body.${THEME_CLASS} #storyinfo,
    body.${THEME_CLASS} .module,
    body.${THEME_CLASS} .tab-content,
    body.${THEME_CLASS} #sidebar,
    body.${THEME_CLASS} .sidebar,
    body.${THEME_CLASS} .module .module-content,
    body.${THEME_CLASS} .cco-div {
        background-color: var(--ffn-bg-secondary) !important;
        border-color: var(--ffn-border-primary) !important;
        color: var(--ffn-text-primary) !important;
    }

    /* ── 10. Review section ───────────────────────────────────────────────── */

    body.${THEME_CLASS} #review,
    body.${THEME_CLASS} #review_title,
    body.${THEME_CLASS} .review-reply {
        background-color: var(--ffn-bg-secondary) !important;
        border-color: var(--ffn-border-primary) !important;
        color: var(--ffn-text-primary) !important;
    }

    /* ── 11. Alert and notice bars ────────────────────────────────────────── */

    body.${THEME_CLASS} .alert.alert-info,
    body.${THEME_CLASS} .gui_note,
    body.${THEME_CLASS} .gui_warning {
        background-color: var(--ffn-bg-secondary) !important;
        border-color: var(--ffn-border-primary) !important;
        color: var(--ffn-text-primary) !important;
    }

    /* ── 12. Modal dialogs ────────────────────────────────────────────────── */

    body.${THEME_CLASS} .modal-content,
    body.${THEME_CLASS} .modal-header,
    body.${THEME_CLASS} .modal-body,
    body.${THEME_CLASS} .modal-footer {
        background-color: var(--ffn-bg-secondary) !important;
        border-color: var(--ffn-border-primary) !important;
        color: var(--ffn-text-primary) !important;
    }

    body.${THEME_CLASS} .modal-header {
        border-bottom-color: var(--ffn-border-primary) !important;
    }

    body.${THEME_CLASS} .modal-footer {
        border-top-color: var(--ffn-border-primary) !important;
    }

    /* ── 13. Tables ───────────────────────────────────────────────────────── */

    body.${THEME_CLASS} table,
    body.${THEME_CLASS} tr,
    body.${THEME_CLASS} td,
    body.${THEME_CLASS} th {
        border-color: var(--ffn-border-primary) !important;
        color: var(--ffn-text-primary) !important;
    }

    body.${THEME_CLASS} tr:nth-child(even) td {
        background-color: var(--ffn-bg-secondary) !important;
    }

    /* ── 14. Headings ─────────────────────────────────────────────────────── */

    body.${THEME_CLASS} h1,
    body.${THEME_CLASS} h2,
    body.${THEME_CLASS} h3,
    body.${THEME_CLASS} h4,
    body.${THEME_CLASS} h5,
    body.${THEME_CLASS} h6 {
        color: var(--ffn-text-primary) !important;
    }

    /* ── 15. Scrollbars (Chromium-based browsers) ────────────────────────── */

    body.${THEME_CLASS} ::-webkit-scrollbar {
        background-color: var(--ffn-bg-primary);
    }

    body.${THEME_CLASS} ::-webkit-scrollbar-thumb {
        background-color: var(--ffn-border-primary);
        border-radius: 4px;
    }

    body.${THEME_CLASS} ::-webkit-scrollbar-thumb:hover {
        background-color: var(--ffn-text-secondary);
    }
`;

// ─── Module-level State ────────────────────────────────────────────────────────

/**
 * The name of the currently active theme.
 * Defaults to 'default' (no theme CSS, no THEME_CLASS on body).
 */
let _activeTheme = 'default';

/**
 * Observer used to apply THEME_CLASS to <body> as soon as it becomes available
 * during document-start execution, before the DOM is fully parsed.
 */
let _bodyObserver: MutationObserver | null = null;

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * ThemeManager
 * * Orchestrates visual theming for the application.
 * Implements FOUC-free dark mode via the EarlyBoot two-phase bootstrapping
 * contract, using CSS custom properties for clean theme-switching without
 * re-injecting the structural CSS rules on every change.
 */
export const ThemeManager = {

    /**
     * ISitewideModule Phase 1 — document-start.
     * Injects the structural CSS (once, idempotent) and, if a theme should be
     * active, injects the variable block and arms the body class observer.
     *
     * Theme resolution order:
     *   1. Explicit localStorage preference (user has made a deliberate choice).
     *   2. OS/browser prefers-color-scheme (fallback for first-time visitors).
     *   3. 'default' — no theming applied.
     *
     * Constraints: must remain fully synchronous.  No await, no setTimeout,
     * no GM_getValue — localStorage.getItem() and matchMedia() are the only
     * permitted reads at this phase.
     */
    prime(): void {
        // The structural CSS is always injected — it is inert (selectors never
        // match) until THEME_CLASS is applied to <body>.
        _injectStructuralCss();

        // TEST: FORCE_DARK_MODE bypasses all storage and preference logic.
        // Flip to true to verify that the CSS injection strategy works correctly
        // before debugging the storage/preference resolution path.
        if (FORCE_DARK_MODE) {
            _log('prime', '[TEST] FORCE_DARK_MODE is enabled — applying dark theme unconditionally.');
            _activeTheme = 'dark';
            _upsertVariableBlock(THEMES['dark']);
            _applyThemeClass(true);
            return;
        }

        const stored = _readStoredThemeRaw();

        if (stored !== null) {
            // User has an explicit preference on record.
            // 'default' stored explicitly means the user has opted out of theming
            // even if their OS is in dark mode — honour that choice.
            if (stored !== 'default' && stored in THEMES) {
                _activeTheme = stored;
                _upsertVariableBlock(THEMES[stored]);
                _applyThemeClass(true);
                _log('prime', `Explicit localStorage preference applied: "${stored}".`);
            } else {
                _log('prime', `Explicit localStorage opt-out ("${stored}") — no theme applied.`);
            }
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            // No explicit preference stored; follow the system setting.
            _activeTheme = 'dark';
            _upsertVariableBlock(THEMES['dark']);
            _applyThemeClass(true);
            _log('prime', 'No stored preference — applied dark theme from prefers-color-scheme.');
        } else {
            _log('prime', 'No stored preference and system is light — no theme applied.');
        }
    },

    /**
     * ISitewideModule Phase 2 — DOMContentLoaded.
     * Reconciles the prime-phase preference with the persisted GM storage value
     * (catches cross-session changes) and wires up the system color-scheme
     * listener so that the theme tracks OS changes when no explicit preference
     * is set.
     */
    init(): void {
        _log('init', 'Starting init sequence...');
        _reconcileWithGmStorage();
        _watchSystemColorScheme();
    },

    /**
     * Public API for the settings menu and future UI to switch themes.
     * Applies the new theme immediately, then writes both localStorage
     * (for next-load prime-time reads) and GM storage (for persistence
     * across sessions).
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
        _writeGmStorage(name);
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
 * Returns true if the given name is a valid theme (either 'default' or a key
 * present in the THEMES registry).
 * @param name - The theme name to validate.
 */
function _isValidTheme(name: string): boolean {
    return name === 'default' || name in THEMES;
}

/**
 * Reads the raw localStorage value for the stored theme, or null if nothing
 * has been stored yet (i.e. the user has never set an explicit preference).
 *
 * Returning null is meaningful: it indicates "no explicit preference" and
 * allows prime() to fall through to the prefers-color-scheme check.
 * A stored value of 'default' is distinct — it means the user has explicitly
 * opted out of theming even if their OS is in dark mode.
 */
function _readStoredThemeRaw(): string | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null && _isValidTheme(stored)) {
            return stored;
        }
    } catch (e) {
        _log('readStoredThemeRaw', `localStorage read error: ${e}`);
    }
    return null;
}

/**
 * Persists the active theme name to localStorage so that prime() can read it
 * synchronously on the next page load.
 * @param name - The theme name to store.
 */
function _writeStoredTheme(name: string): void {
    try {
        localStorage.setItem(STORAGE_KEY, name);
    } catch (_e) {
        _log('writeStoredTheme', 'Failed to write theme to localStorage.');
    }
}

/**
 * Removes the theme entry from localStorage.
 * Used to clear stale 'default' entries written by older extension versions,
 * so that prime() falls through to the prefers-color-scheme check on the next load.
 */
function _clearStoredTheme(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        _log('clearStoredTheme', `localStorage remove error: ${e}`);
    }
}

/**
 * Injects the structural <style> tag (STRUCTURAL_CSS) onto the document.
 * Uses document.head when available, falls back to document.documentElement
 * at document-start time before <head> has been parsed.
 * Idempotent — no-ops if the tag already exists.
 */
function _injectStructuralCss(): void {
    if (document.getElementById(STRUCTURAL_STYLE_TAG_ID)) {
        return;
    }

    const style = document.createElement('style');
    style.id = STRUCTURAL_STYLE_TAG_ID;
    style.textContent = STRUCTURAL_CSS;

    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.documentElement.appendChild(style);
    }

    _log('injectStructuralCss', 'Structural theme CSS injected.');
}

/**
 * Generates the CSS custom property declaration block for a given theme.
 * The returned string is injected as the content of VARIABLE_STYLE_TAG_ID.
 * Replacing this block is all that is needed to switch themes at runtime.
 * @param theme - The ITheme data object to build variables from.
 */
function _buildVariableBlock(theme: ITheme): string {
    return `
        body.${THEME_CLASS} {
            --ffn-bg-primary:     ${theme.bgPrimary};
            --ffn-bg-secondary:   ${theme.bgSecondary};
            --ffn-bg-input:       ${theme.bgInput};
            --ffn-bg-nav:         ${theme.bgNav};
            --ffn-text-primary:   ${theme.textPrimary};
            --ffn-text-secondary: ${theme.textSecondary};
            --ffn-text-input:     ${theme.textInput};
            --ffn-border-primary: ${theme.borderPrimary};
        }
    `;
}

/**
 * Creates or updates the variable block <style> tag for the given theme.
 * If the tag already exists its textContent is replaced in-place, avoiding
 * a DOM removal/insertion cycle and preventing any intermediate repaint.
 * @param theme - The ITheme data object whose tokens to inject.
 */
function _upsertVariableBlock(theme: ITheme): void {
    const css = _buildVariableBlock(theme);
    const existing = document.getElementById(VARIABLE_STYLE_TAG_ID);

    if (existing) {
        existing.textContent = css;
        _log('upsertVariableBlock', `Variable block updated for theme "${theme.name}".`);
        return;
    }

    const style = document.createElement('style');
    style.id = VARIABLE_STYLE_TAG_ID;
    style.textContent = css;

    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.documentElement.appendChild(style);
    }

    _log('upsertVariableBlock', `Variable block injected for theme "${theme.name}".`);
}

/**
 * Removes the variable block <style> tag from the DOM.
 * Called when reverting to 'default' (no theme active).
 */
function _removeVariableBlock(): void {
    const existing = document.getElementById(VARIABLE_STYLE_TAG_ID);
    if (existing) {
        existing.remove();
        _log('removeVariableBlock', 'Variable block removed.');
    }
}

/**
 * Applies or clears a theme by name.
 * For non-default themes: upserts the variable block and adds THEME_CLASS.
 * For 'default': removes the variable block and removes THEME_CLASS.
 * @param name - The theme name to apply, or 'default' to clear.
 */
function _applyTheme(name: string): void {
    if (name === 'default') {
        _removeVariableBlock();
        _applyThemeClass(false);
    } else {
        const theme = THEMES[name];
        if (!theme) {
            return;
        }
        _upsertVariableBlock(theme);
        _applyThemeClass(true);
    }
}

/**
 * Applies or removes THEME_CLASS on <body> to activate or deactivate theme
 * scoping.  Mirrors LayoutManager._applyFluidClass(): if <body> is not yet
 * in the DOM at document-start time, a MutationObserver is armed to apply
 * the class as soon as <body> is inserted.
 * @param enable - True to add THEME_CLASS, false to remove it.
 */
function _applyThemeClass(enable: boolean): void {
    const body = document.body;

    if (_bodyObserver) {
        _bodyObserver.disconnect();
        _bodyObserver = null;
    }

    if (body) {
        if (enable) {
            if (!body.classList.contains(THEME_CLASS)) {
                body.classList.add(THEME_CLASS);
                _log('applyThemeClass', 'Theme class applied to body.');
            }
        } else if (body.classList.contains(THEME_CLASS)) {
            body.classList.remove(THEME_CLASS);
            _log('applyThemeClass', 'Theme class removed from body.');
        }
        return;
    }

    if (enable) {
        _bodyObserver = new MutationObserver((mutations) => {
            let bodyAdded = false;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node === document.body) {
                        bodyAdded = true;
                        break;
                    }
                }
                if (bodyAdded) {
                    break;
                }
            }

            if (!bodyAdded) {
                return;
            }

            const currentBody = document.body;
            if (!currentBody) {
                return;
            }

            if (!currentBody.classList.contains(THEME_CLASS)) {
                currentBody.classList.add(THEME_CLASS);
                _log('applyThemeClass', 'Theme class applied on body creation.');
            }

            if (_bodyObserver) {
                _bodyObserver.disconnect();
                _bodyObserver = null;
            }
        });

        _bodyObserver.observe(document.documentElement, { childList: true });
    }
}

/**
 * Reconciles the prime-phase localStorage/matchMedia value with GM storage.
 * GM_getValue is the Tampermonkey-native persistent storage API and replaces
 * the chrome.storage.sync approach, which is unavailable in userscript contexts.
 *
 * GM storage is the authoritative record of explicit user intent: it is written
 * only by setTheme().  localStorage is a fast-read cache for prime() — but it
 * may contain stale 'default' entries written by older extension versions.
 *
 * When GM storage holds no value:
 *   - If localStorage also has no entry: prime()'s matchMedia resolution is correct.
 *   - If localStorage has a stale 'default' (no paired GM entry): the entry was
 *     written by an older buggy run, not by the user. Clear it and re-apply the
 *     system preference so both the current page load and future loads behave
 *     correctly.
 *
 * When GM storage holds an explicit value: reconcile against it, covering the
 * case where the user updated their preference in another browser session.
 */
function _reconcileWithGmStorage(): void {
    let gmRaw: string | undefined;
    try {
        // Use undefined (not 'default') as the fallback so that "never set"
        // is distinguishable from "user explicitly chose default/light mode".
        // The declared type on gmRaw ensures the return is treated as string | undefined.
        gmRaw = GM_getValue(GM_STORAGE_KEY, undefined as string | undefined);
    } catch (e) {
        _log('reconcileWithGmStorage', `GM_getValue error: ${e}`);
        return;
    }

    if (gmRaw === undefined) {
        // No explicit user preference in GM storage.
        const localStored = _readStoredThemeRaw();

        if (localStored === 'default') {
            // localStorage has 'default' but GM has nothing.
            // A legitimate 'default' is always written by setTheme() which also
            // writes to GM.  A solo localStorage 'default' is a stale entry from
            // an older version. Clear it and apply the real system preference.
            _log('reconcileWithGmStorage', 'Stale localStorage opt-out found with no GM record — clearing and re-applying system preference.');
            _clearStoredTheme();

            const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (systemDark && _activeTheme !== 'dark') {
                _activeTheme = 'dark';
                _applyTheme('dark');
                _log('reconcileWithGmStorage', 'Re-applied dark theme from system prefers-color-scheme.');
            } else if (!systemDark && _activeTheme === 'dark') {
                _activeTheme = 'default';
                _applyTheme('default');
                _log('reconcileWithGmStorage', 'System is light; removed dark theme.');
            }
        } else {
            // No localStorage entry either — prime()'s resolution was correct.
            _log('reconcileWithGmStorage', 'No GM preference on record; preserving prime() resolution.');
        }
        return;
    }

    const gmTheme = _isValidTheme(gmRaw) ? gmRaw : 'default';

    if (gmTheme !== _activeTheme) {
        _log('reconcileWithGmStorage', `GM theme "${gmTheme}" differs from active "${_activeTheme}". Re-applying.`);
        _activeTheme = gmTheme;
        _applyTheme(gmTheme);
        _writeStoredTheme(gmTheme);
    } else {
        _log('reconcileWithGmStorage', `Theme "${_activeTheme}" is in sync with GM storage.`);
    }
}

/**
 * Persists the active theme name to GM storage for cross-session persistence.
 * GM_setValue is the Tampermonkey-native replacement for chrome.storage.sync
 * in userscript contexts.
 * @param name - The theme name to store.
 */
function _writeGmStorage(name: string): void {
    try {
        GM_setValue(GM_STORAGE_KEY, name);
    } catch (e) {
        _log('writeGmStorage', `GM_setValue error: ${e}`);
    }
}

/**
 * Arms a MediaQueryList change listener on prefers-color-scheme.
 * Reacts to OS/browser dark/light mode changes unless the user has an
 * explicit preference recorded in GM storage (written only by setTheme()).
 *
 * The guard intentionally uses GM storage, not localStorage.  localStorage
 * may contain stale entries from older extension versions; only a GM entry
 * is proof of a deliberate in-extension user choice that should override
 * the system setting.
 */
function _watchSystemColorScheme(): void {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only bail if the user has an explicit preference in GM storage.
        // GM storage is written exclusively by setTheme() — it is the authoritative
        // record of deliberate user intent.  Do NOT guard on localStorage, which
        // may hold stale 'default' entries from older runs.
        let gmRaw: string | undefined;
        try {
            gmRaw = GM_getValue(GM_STORAGE_KEY, undefined as string | undefined);
        } catch (e) {
            _log('watchSystemColorScheme', `GM_getValue error: ${e}`);
        }

        if (gmRaw !== undefined) {
            return;
        }

        const target = e.matches ? 'dark' : 'default';
        _log('watchSystemColorScheme', `System color scheme changed. Applying "${target}".`);
        _activeTheme = target;
        _applyTheme(target);
        // Intentionally do NOT write to localStorage/GM — we want prime() to keep
        // checking the system preference on subsequent page loads.
    });
}
