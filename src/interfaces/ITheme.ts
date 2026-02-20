// interfaces/ITheme.ts

/**
 * ITheme
 * * Contract for all theme data objects in the THEMES registry.
 *
 * Defines every semantic color token the theming system supports.
 * Theme objects carry pure TypeScript data — no CSS syntax — so that
 * adding a new theme is a matter of providing a different set of hex values,
 * with no knowledge of CSS selectors required.
 *
 * Every token here maps to a CSS custom property (--ffn-<token>) declared by
 * ThemeManager._buildVariableBlock().  Adding a new token requires:
 *   1. A new readonly property in this interface (TypeScript enforces completeness).
 *   2. A corresponding var(--ffn-<token>) reference in ThemeManager.STRUCTURAL_CSS.
 *   3. A value for the new property in every theme file.
 */
export interface ITheme {
    readonly name: string;

    // ── Backgrounds ───────────────────────────────────────────────────────────

    /** Main page background — body, content wrappers, nav rows. */
    readonly bgPrimary: string;

    /** Secondary surface — story header, listing cards, reading area, panels. */
    readonly bgSecondary: string;

    /** Form control background — input, select, textarea, buttons. */
    readonly bgInput: string;

    /** Navigation chrome background — .menulink, #zmenu, .z-top-container. */
    readonly bgNav: string;

    // ── Text ──────────────────────────────────────────────────────────────────

    /** Primary content text — maps to FFN's .xcontrast_txt semantic class. */
    readonly textPrimary: string;

    /** Muted/metadata text — maps to FFN's .xgray semantic class. */
    readonly textSecondary: string;

    /** Form control text — text inside input, select, textarea. */
    readonly textInput: string;

    // ── Borders ───────────────────────────────────────────────────────────────

    /** General borders and dividers — cards, panels, form controls. */
    readonly borderPrimary: string;
}
