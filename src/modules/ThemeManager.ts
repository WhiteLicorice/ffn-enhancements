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
 * ID of the injected <style> tag that holds the per-theme filter CSS.
 * Contains Layer 1 (body inversion) and Layers 2-3 (preserveSelectors /
 * invertSelectors re-inversions), generated from the active theme's fields.
 * Replaced (textContent swap) when the theme changes; removed when reverting
 * to 'default'.
 */
const FILTER_STYLE_TAG_ID = 'ffn-enhancements-theme-filters';

/**
 * ID of the injected <style> tag that holds the per-theme Layer 4 user CSS.
 * Replaced (textContent swap) when the theme changes; removed entirely when
 * reverting to 'default' or when the active theme has no userCss.
 */
const USER_CSS_STYLE_TAG_ID = 'ffn-enhancements-theme-user';

/**
 * ID of the <style> tag injected into TinyMCE (and other rich-editor) iframe
 * documents to apply dark-mode inversion inside the iframe's own browsing
 * context.  Each matching iframe gets one tag with this ID in its own <head>.
 */
const IFRAME_STYLE_TAG_ID = 'ffn-enhancements-theme-iframe';

/**
 * The CSS filter value used for both the page-level inversion (Layer 1) and
 * the element-level re-inversion (Layers 2–3, preserve/invertSelectors).
 * Centralised here so both _buildFilterCss and _buildIframeCss stay in sync
 * without duplicating the string.
 */
const INVERT_FILTER = 'invert(1) hue-rotate(180deg)';

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
 * Set to true to verify that the CSS injection strategy (filter CSS +
 * THEME_CLASS on body) works as intended, independently of the
 * localStorage / prefers-color-scheme resolution path.
 * Must be false in production.
 */
const FORCE_DARK_MODE = false;

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

/**
 * Observer watching for dynamically spawned TinyMCE (or other rich-editor)
 * iframes matching the active theme's iframeSelectors.
 * Active while a non-default theme with at least one iframeSelector is applied.
 * Disconnected and nulled when the theme reverts to 'default' or changes.
 */
let _iframeObserver: MutationObserver | null = null;

/**
 * Set of iframe elements that have received direct dark-mode CSS injection into
 * their contentDocument.  Used for targeted cleanup when the theme changes.
 */
let _trackedIframes: Set<HTMLIFrameElement> = new Set();

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
     * If a theme should be active, injects the filter CSS (Layers 1–3) and the
     * Layer 4 user CSS, then arms the body class observer.
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
        // TEST: FORCE_DARK_MODE bypasses all storage and preference logic.
        // Flip to true to verify that the CSS injection strategy works correctly
        // before debugging the storage/preference resolution path.
        if (FORCE_DARK_MODE) {
            _log('prime', '[TEST] FORCE_DARK_MODE is enabled — applying dark theme unconditionally.');
            _activeTheme = 'dark';
            _upsertFilterCss(THEMES['dark']);
            _upsertUserCss(THEMES['dark']);
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
                _upsertFilterCss(THEMES[stored]);
                _upsertUserCss(THEMES[stored]);
                _applyThemeClass(true);
                _log('prime', `Explicit localStorage preference applied: "${stored}".`);
            } else {
                _log('prime', `Explicit localStorage opt-out ("${stored}") — no theme applied.`);
            }
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            // No explicit preference stored; follow the system setting.
            _activeTheme = 'dark';
            _upsertFilterCss(THEMES['dark']);
            _upsertUserCss(THEMES['dark']);
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
     * is set.  Also starts the iframe injection watcher for themes that target
     * rich-editor iframes (e.g. TinyMCE).
     */
    init(): void {
        _log('init', 'Starting init sequence...');
        _reconcileWithGmStorage();
        _watchSystemColorScheme();
        _syncIframeInjection();
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
        _syncIframeInjection();
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
 * Generates the filter CSS (Layers 1–3) for a given theme from its data fields.
 *
 * Layer 1 (body inversion) fires only when theme.isDarkTheme is true.
 * Layer 2/3 (preserveSelectors re-inversion) fires only for dark themes —
 *   each listed selector gets filter: invert(1) hue-rotate(180deg) to cancel
 *   the html inversion and restore original colors.
 * invertSelectors (force inversion) fires only for non-dark themes —
 *   each listed selector gets filter: invert(1) hue-rotate(180deg) to darken
 *   specific elements against the un-inverted light background.
 *
 * The filter is applied to the <html> element (not <body>) so that the composite
 * scope covers ALL page content.  When body carries both overflow-x:hidden (from
 * LayoutManager) and filter, Chromium can exclude elements near the overflow
 * boundary (such as #p_footer) from the filter's composite layer.  Anchoring
 * the filter to the document root avoids this edge-case entirely.
 *
 * NOTE: invertSelectors is a no-op in dark themes (isDarkTheme: true) because
 * the html filter already inverts everything — elements are already dark.
 * preserveSelectors is a no-op in light themes (isDarkTheme: false) because
 * no html inversion is applied — elements are already at their original colors.
 *
 * If a selector appears in both invertSelectors and preserveSelectors,
 * preserveSelectors wins by cascade order (its rules are generated last).
 * @param theme - The ITheme data object to build filter CSS from.
 */
function _buildFilterCss(theme: ITheme): string {
    const parts: string[] = [];

    // Layer 1: base inversion on the root element — dark themes only.
    // Anchoring the filter to <html> (not <body>) ensures the composite scope
    // covers all page content, including elements that can escape a body-level
    // filter (e.g. #p_footer on pages where body has overflow-x: hidden).
    if (theme.isDarkTheme) {
        parts.push(
            `    /* ── Layer 1: Base inversion (html root) ── */\n` +
            `    html.${THEME_CLASS} {\n` +
            `        filter: ${INVERT_FILTER};\n` +
            `    }`,
        );
    }

    // invertSelectors — meaningful only for non-dark themes.
    // In dark themes the html filter already handles inversion; this list
    // is a no-op and no rules are emitted.
    if (!theme.isDarkTheme && theme.invertSelectors.length > 0) {
        const selectors = theme.invertSelectors
            .map(s => `    html.${THEME_CLASS} ${s}`)
            .join(',\n');
        parts.push(
            `    /* ── invertSelectors: Force inversion (light theme) ── */\n` +
            `${selectors} {\n` +
            `        filter: ${INVERT_FILTER};\n` +
            `    }`,
        );
    }

    // preserveSelectors — meaningful only for dark themes.
    // Re-invert each listed element to cancel the html filter and restore
    // its original colors.  In light themes (isDarkTheme: false) no html
    // inversion is active, so no rules are emitted.
    if (theme.isDarkTheme && theme.preserveSelectors.length > 0) {
        const selectors = theme.preserveSelectors
            .map(s => `    html.${THEME_CLASS} ${s}`)
            .join(',\n');
        parts.push(
            `    /* ── Layers 2-3: Preserve original appearance ── */\n` +
            `${selectors} {\n` +
            `        filter: ${INVERT_FILTER};\n` +
            `    }`,
        );
    }

    if (parts.length === 0) {
        return '';
    }

    return (
        `/* --- FFN Enhancements: Theme Filter Rules (${theme.name}) ---\n` +
        `   Scoped under html.${THEME_CLASS} — inert when no theme is active. */\n\n` +
        parts.join('\n\n')
    );
}

/**
 * Creates or updates the filter CSS <style> tag for the given theme.
 * If the tag already exists, its textContent is replaced in-place to avoid
 * a DOM removal/insertion cycle and prevent any intermediate repaint.
 * If the theme generates no filter CSS (e.g. a light theme with no
 * invertSelectors), any existing tag is removed.
 * @param theme - The ITheme data object to build filter CSS from.
 */
function _upsertFilterCss(theme: ITheme): void {
    const css = _buildFilterCss(theme);
    const existing = document.getElementById(FILTER_STYLE_TAG_ID);

    if (!css) {
        if (existing) {
            existing.remove();
            _log('upsertFilterCss', `Filter CSS removed (theme "${theme.name}" generates none).`);
        }
        return;
    }

    if (existing) {
        existing.textContent = css;
        _log('upsertFilterCss', `Filter CSS updated for theme "${theme.name}".`);
        return;
    }

    const style = document.createElement('style');
    style.id = FILTER_STYLE_TAG_ID;
    style.textContent = css;

    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.documentElement.appendChild(style);
    }

    _log('upsertFilterCss', `Filter CSS injected for theme "${theme.name}".`);
}

/**
 * Removes the filter CSS <style> tag from the DOM.
 * Called when reverting to 'default' (no theme active).
 */
function _removeFilterCss(): void {
    const existing = document.getElementById(FILTER_STYLE_TAG_ID);
    if (existing) {
        existing.remove();
        _log('removeFilterCss', 'Filter CSS removed.');
    }
}

/**
 * Creates or updates the Layer 4 user CSS <style> tag for the given theme.
 * If the tag already exists, its textContent is replaced in-place to avoid
 * a DOM removal/insertion cycle and prevent any intermediate repaint.
 * If the theme has no userCss, any existing tag is removed (no empty node left).
 * @param theme - The ITheme data object whose userCss to inject.
 */
function _upsertUserCss(theme: ITheme): void {
    const existing = document.getElementById(USER_CSS_STYLE_TAG_ID);

    if (!theme.userCss) {
        // Theme has no Layer 4 CSS — remove any previously-injected tag.
        if (existing) {
            existing.remove();
            _log('upsertUserCss', `User CSS removed (theme "${theme.name}" has none).`);
        }
        return;
    }

    if (existing) {
        existing.textContent = theme.userCss;
        _log('upsertUserCss', `User CSS updated for theme "${theme.name}".`);
        return;
    }

    const style = document.createElement('style');
    style.id = USER_CSS_STYLE_TAG_ID;
    style.textContent = theme.userCss;

    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.documentElement.appendChild(style);
    }

    _log('upsertUserCss', `User CSS injected for theme "${theme.name}".`);
}

/**
 * Removes the Layer 4 user CSS <style> tag from the DOM.
 * Called when reverting to 'default' (no theme active).
 */
function _removeUserCss(): void {
    const existing = document.getElementById(USER_CSS_STYLE_TAG_ID);
    if (existing) {
        existing.remove();
        _log('removeUserCss', 'User CSS removed.');
    }
}

// ─── Iframe CSS Injection (TinyMCE / Rich Editors) ────────────────────────────

/**
 * Generates the CSS to inject directly into a TinyMCE (or other rich-editor)
 * iframe's contentDocument when a dark theme is active.
 *
 * The parent page's `html.ffn-theme { filter: invert(1) hue-rotate(180deg) }` creates
 * a page-level compositing layer that covers ALL same-origin content, including
 * child <iframe> elements.  This means the parent filter already inverts the
 * TinyMCE iframe's rendered pixels — dark mode is achieved without any additional
 * injection on the <body> inside the iframe.
 *
 * Injecting a second `body { filter: invert }` inside the iframe would produce a
 * DOUBLE inversion (parent + iframe = two inversions = original light-mode colours),
 * which is the root cause of the "flickers dark then turns white-on-white" bug.
 *
 * What we DO inject is the preserveSelectors re-inversion:  elements inside the
 * editor (e.g. user-inserted <img>) are inverted once by the parent filter; we
 * re-invert them here to restore their original colours (double-invert is a no-op
 * on pixel values).
 *
 * If the theme has no preserveSelectors, nothing needs to be injected and this
 * function returns '' — no <style> tag is created for that iframe.
 *
 * @param theme - The active ITheme data object.
 * @returns A CSS string to inject into the iframe document, or '' if not needed.
 */
function _buildIframeCss(theme: ITheme): string {
    if (!theme.isDarkTheme || theme.preserveSelectors.length === 0) {
        return '';
    }

    // Only re-invert elements listed in preserveSelectors.
    // The parent html.ffn-theme filter handles the base dark-mode inversion for
    // the iframe; this CSS only corrects specific child elements (e.g. images)
    // so they are not double-inverted by the parent filter.
    const selectors = theme.preserveSelectors.join(',\n');
    return (
        `/* FFN Enhancements: Dark mode (${theme.name}) — injected into iframe */\n` +
        `/* Re-invert to cancel the parent-page filter's effect on these elements */\n\n` +
        `${selectors} {\n    filter: ${INVERT_FILTER} !important;\n}`
    );
}

/**
 * Injects or updates the dark-mode inversion <style> tag inside a single
 * iframe's contentDocument.  If the iframe has not yet loaded, waits for its
 * 'load' event before injecting.
 *
 * @param iframe - The target <iframe> element.
 * @param css    - The CSS string to inject.
 */
function _injectCssIntoIframe(iframe: HTMLIFrameElement, css: string): void {
    const inject = () => {
        try {
            const doc = iframe.contentDocument;
            if (!doc || !doc.head) {
                return;
            }

            let styleTag = doc.getElementById(IFRAME_STYLE_TAG_ID) as HTMLStyleElement | null;
            if (styleTag) {
                styleTag.textContent = css;
            } else {
                styleTag = doc.createElement('style');
                styleTag.id = IFRAME_STYLE_TAG_ID;
                styleTag.textContent = css;
                doc.head.appendChild(styleTag);
            }

            _trackedIframes.add(iframe);
            _log('injectCssIntoIframe', `Injected dark mode CSS into iframe "${iframe.id}".`);
        } catch (e) {
            // Cross-origin iframes will throw on contentDocument access; silently skip.
            _log('injectCssIntoIframe', `Could not access iframe "${iframe.id}": ${e}`);
        }
    };

    if (iframe.contentDocument?.readyState === 'complete') {
        inject();
    } else {
        iframe.addEventListener('load', inject, { once: true });
    }
}

/**
 * Removes the dark-mode <style> tag from a single iframe's contentDocument
 * and removes the iframe from the tracked set.
 *
 * @param iframe - The iframe to clean up.
 */
function _removeCssFromIframe(iframe: HTMLIFrameElement): void {
    try {
        const doc = iframe.contentDocument;
        if (doc) {
            const styleTag = doc.getElementById(IFRAME_STYLE_TAG_ID);
            if (styleTag) {
                styleTag.remove();
                _log('removeCssFromIframe', `Removed dark mode CSS from iframe "${iframe.id}".`);
            }
        }
    } catch {
        // Cross-origin or detached iframe — nothing to clean up.
    }
    _trackedIframes.delete(iframe);
}

/**
 * Tears down all active iframe CSS injection:
 * - Disconnects the MutationObserver watching for new iframes.
 * - Removes injected <style> tags from all tracked iframes.
 * - Clears the tracked iframe set.
 */
function _clearIframeInjections(): void {
    if (_iframeObserver) {
        _iframeObserver.disconnect();
        _iframeObserver = null;
    }

    for (const iframe of _trackedIframes) {
        _removeCssFromIframe(iframe);
    }
    _trackedIframes.clear();
}

/**
 * Starts the MutationObserver that watches for TinyMCE (or other rich-editor)
 * iframes matching the active theme's iframeSelectors, and injects dark-mode
 * CSS into each one's contentDocument.
 *
 * Also performs an immediate scan of any matching iframes already in the DOM
 * at call time (covers the case where the editor was initialised before init()).
 *
 * @param theme - The ITheme data object whose iframeSelectors to monitor.
 */
function _watchDynamicIframes(theme: ITheme): void {
    const selectors = theme.iframeSelectors;
    if (!selectors || selectors.length === 0) {
        return;
    }

    const iframeCss = _buildIframeCss(theme);
    if (!iframeCss) {
        return;
    }

    // Inject into any iframes already present in the DOM at init time.
    for (const selector of selectors) {
        try {
            document.querySelectorAll<HTMLIFrameElement>(selector).forEach(iframe => {
                _injectCssIntoIframe(iframe, iframeCss);
            });
        } catch (e) {
            _log('watchDynamicIframes', `Invalid selector "${selector}": ${e}`);
        }
    }

    // Observe the document for dynamically spawned iframes (TinyMCE is lazy-loaded
    // — it initialises after user interaction, not at page load).
    if (_iframeObserver) {
        _iframeObserver.disconnect();
    }

    _iframeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) {
                    continue;
                }

                // Check the added node itself if it is an iframe.
                if (node instanceof HTMLIFrameElement) {
                    const matches = selectors.some(selector => {
                        try {
                            return node.matches(selector);
                        } catch {
                            return false;
                        }
                    });
                    if (matches) {
                        _injectCssIntoIframe(node, iframeCss);
                    }
                }

                // Also query for iframes nested inside the added node
                // (e.g. TinyMCE may insert a wrapper <div> that contains
                // the editor <iframe> in a single DOM operation).
                for (const selector of selectors) {
                    try {
                        node.querySelectorAll<HTMLIFrameElement>(selector).forEach(iframe => {
                            _injectCssIntoIframe(iframe, iframeCss);
                        });
                    } catch {
                        // Invalid or unsupported selector — skip silently.
                    }
                }
            }
        }
    });

    _iframeObserver.observe(
        document.body ?? document.documentElement,
        { childList: true, subtree: true },
    );

    _log('watchDynamicIframes', `Watching for iframes: ${selectors.join(', ')}`);
}

/**
 * Synchronises iframe CSS injection with the current _activeTheme.
 * Tears down any existing injection and restarts it for the new theme,
 * or clears it entirely when reverting to 'default'.
 *
 * Called after any event that changes _activeTheme: init(), setTheme(),
 * and the prefers-color-scheme change listener.
 */
function _syncIframeInjection(): void {
    _clearIframeInjections();
    if (_activeTheme !== 'default' && _activeTheme in THEMES) {
        _watchDynamicIframes(THEMES[_activeTheme]);
    }
}

/**
 * Applies or clears a theme by name.
 * For non-default themes: checks for selector conflicts, upserts filter CSS
 * (Layers 1–3) and Layer 4 user CSS, then adds THEME_CLASS to <body>.
 * For 'default': removes filter CSS, user CSS, and THEME_CLASS.
 * @param name - The theme name to apply, or 'default' to clear.
 */
function _applyTheme(name: string): void {
    if (name === 'default') {
        _removeFilterCss();
        _removeUserCss();
        _applyThemeClass(false);
    } else {
        const theme = THEMES[name];
        if (!theme) {
            return;
        }

        // Warn if a selector appears in both arrays.
        // preserveSelectors wins by cascade — its rules are generated last.
        const conflict = theme.invertSelectors.filter(
            s => (theme.preserveSelectors as readonly string[]).includes(s),
        );
        if (conflict.length > 0) {
            _log(
                'applyTheme',
                `Selector conflict in theme "${theme.name}": ` +
                `[${conflict.join(', ')}] appear in both invertSelectors and ` +
                `preserveSelectors. preserveSelectors takes precedence.`,
            );
        }

        _upsertFilterCss(theme);
        _upsertUserCss(theme);
        _applyThemeClass(true);
    }
}

/**
 * Applies or removes THEME_CLASS on <html> (document.documentElement) to
 * activate or deactivate theme scoping.
 *
 * The class is placed on <html> rather than <body> for two reasons:
 *   1. document.documentElement is always present — even at document-start
 *      before <body> is parsed — eliminating the need for a MutationObserver.
 *   2. The filter CSS rules use html.THEME_CLASS as their selector root,
 *      anchoring the filter composite to the document root so that all page
 *      content (including #p_footer and other elements that can escape a
 *      body-level filter when body has overflow-x: hidden) is covered.
 *
 * @param enable - True to add THEME_CLASS to <html>, false to remove it.
 */
function _applyThemeClass(enable: boolean): void {
    // Disconnect any pending body observer from a previous prime() call.
    // (Kept for safety; the observer is no longer armed now that we target html.)
    if (_bodyObserver) {
        _bodyObserver.disconnect();
        _bodyObserver = null;
    }

    const html = document.documentElement; // always present
    if (enable) {
        if (!html.classList.contains(THEME_CLASS)) {
            html.classList.add(THEME_CLASS);
            _log('applyThemeClass', 'Theme class applied to html.');
        }
    } else if (html.classList.contains(THEME_CLASS)) {
        html.classList.remove(THEME_CLASS);
        _log('applyThemeClass', 'Theme class removed from html.');
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
        _syncIframeInjection();
        // Intentionally do NOT write to localStorage/GM — we want prime() to keep
        // checking the system preference on subsequent page loads.
    });
}
