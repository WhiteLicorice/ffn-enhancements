// interfaces/ITheme.ts

/**
 * ITheme
 * * Contract for all theme data objects in the THEMES registry.
 *
 * The theming system is a hybrid filter architecture with four layers:
 *
 *   Layer 1 — filter: invert(1) hue-rotate(180deg) on body.
 *   Layer 2 — Re-invert img, canvas, video to restore original appearance.
 *   Layer 3 — Re-invert explicit brand exclusions (e.g. #top nav bar).
 *   Layer 4 — userCss: per-theme overrides injected last with full specificity.
 *
 * Layers 1–3 are structural and identical for all themes — they live in
 * ThemeManager.STRUCTURAL_CSS and require no per-theme data.
 *
 * Layer 4 (userCss) is the only thing that differs between themes.  It is
 * the extension point for fine-tuning elements the filter layers don't handle
 * perfectly, and for future custom skin/palette support (à la AO3 site skins).
 *
 * Adding a new theme requires only:
 *   1. A new ITheme object with name and userCss.
 *   2. A single entry in themes/index.ts.
 *   No changes to ThemeManager are needed.
 */
export interface ITheme {
    readonly name: string;

    /**
     * Layer 4 — user/theme CSS injected last with full specificity.
     * Use this field to correct specific elements the filter layers don't handle
     * perfectly (e.g. slightly-off brand colors, embedded iframes, custom widgets).
     *
     * An empty string means no Layer 4 overrides — the filter layers alone are
     * sufficient for this theme.
     */
    readonly userCss: string;
}
