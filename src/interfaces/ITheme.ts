// interfaces/ITheme.ts

/**
 * ITheme
 * * Contract for all theme data objects in the THEMES registry.
 *
 * The theming system is a hybrid filter architecture with four layers:
 *
 *   Layer 1 — filter: invert(1) hue-rotate(180deg) on body (dark themes only).
 *   Layer 2 — Re-invert preserveSelectors elements to restore original colors.
 *   Layer 3 — (same mechanism as Layer 2 via preserveSelectors — brand elements).
 *   Layer 4 — userCss: per-theme overrides injected last with full specificity.
 *
 * A theme controls Layers 1–3 entirely through its data fields:
 *   isDarkTheme       → whether Layer 1 fires at all.
 *   invertSelectors   → elements forced dark when theme is active (light themes).
 *   preserveSelectors → elements restored to original colors (dark themes).
 *
 * Layer 4 (userCss) is the extension point for fine-tuning anything the filter
 * layers don't handle perfectly, and for future custom skin/palette support.
 *
 * Adding a new theme requires only:
 *   1. A new ITheme object with all fields populated.
 *   2. A single entry in themes/index.ts.
 *   No changes to ThemeManager are needed.
 */
export interface ITheme {
    readonly name: string;

    /**
     * When true, ThemeManager applies a base inversion filter (Layer 1) to the
     * entire page, making this a dark-mode theme regardless of the OS setting.
     * Layers 2–3 (preserveSelectors re-inversions) only fire when this is true.
     *
     * Set to false for themes that do not use the filter stack — e.g. a custom
     * light palette theme that relies entirely on Layer 4 (userCss).
     */
    readonly isDarkTheme: boolean;

    /**
     * Selectors for elements that must appear inverted (dark) when this theme is
     * active, regardless of the OS color scheme.
     *
     * In a dark theme (isDarkTheme: true) the body filter already inverts
     * everything, so these elements are already dark by inheritance — this list
     * is a no-op and no CSS rules are generated for it.  It is meaningful for
     * non-dark themes (isDarkTheme: false), where no body filter is applied: each
     * listed selector receives an explicit filter: invert(1) hue-rotate(180deg)
     * rule to force it dark against the light background.
     *
     * If a selector appears in both invertSelectors and preserveSelectors,
     * ThemeManager logs a warning.  preserveSelectors takes precedence because
     * its CSS rules are generated after invertSelectors and win the cascade.
     */
    readonly invertSelectors: readonly string[];

    /**
     * Selectors for elements that must retain their original, uninverted
     * appearance when this theme is active — brand elements, media, etc.
     *
     * In a dark theme (isDarkTheme: true), each listed selector receives an
     * explicit filter: invert(1) hue-rotate(180deg) rule to cancel the body
     * inversion and restore original colors.  In a light theme
     * (isDarkTheme: false), no body inversion is applied so these elements are
     * already at their original appearance — the list is a no-op.
     *
     * If a selector appears in both invertSelectors and preserveSelectors,
     * ThemeManager logs a warning.  preserveSelectors takes precedence.
     */
    readonly preserveSelectors: readonly string[];

    /**
     * Layer 4 — user/theme CSS injected last with full specificity.
     * Use this field to correct specific elements the filter layers don't handle
     * perfectly (e.g. slightly-off brand colors, embedded iframes, custom widgets).
     *
     * An empty string means no Layer 4 overrides — the filter layers alone are
     * sufficient for this theme.
     */
    readonly userCss: string;

    /**
     * CSS selectors (evaluated in the parent document) that match <iframe>
     * elements whose contentDocument should receive direct CSS injection.
     *
     * CSS filter on an ancestor element may not propagate into separate browsing
     * contexts (iframe documents) in all browsers.  For iframes hosting rich
     * editors — such as TinyMCE, which FFN uses for the review box and document
     * editor — ThemeManager.init() uses a MutationObserver to detect matching
     * iframes and injects the theme's inversion CSS directly into each iframe's
     * contentDocument.head.
     *
     * TinyMCE 4/5 follows the naming convention <originalTextareaId>_ifr for its
     * editor iframes (e.g. 'review_review_ifr', 'bio_ifr').
     *
     * An empty array means no iframes require direct CSS injection for this theme.
     */
    readonly iframeSelectors: readonly string[];
}
