// ─── Brand Colors ───────────────────────────────────────────────────────────
export const BRAND = {
    PRIMARY: '#29297a',
    DARK: '#1f1f5c',
    BG: '#f0f4f8',
    TEXT: '#234d73',
    HOVER_BG: '#e3edf7',
    HOVER_TEXT: '#123a5a',
    FOCUS_GLOW: 'rgba(41, 41, 122, 0.2)',
} as const;

// ─── Semantic Colors ───────────────────────────────────────────────────────
export const SEMANTIC = {
    SUCCESS_TEXT: '#236423',
    SUCCESS_BG: '#edf9ed',
    ERROR_TEXT: '#8b0000',
    ERROR_BG: '#fff0f0',
    ERROR_BORDER: '#d8a0a0',
    WARNING_TEXT: '#8a5c00',
    WARNING_TEXT_DARK: '#8a3b00',
    WARNING_BG: '#fff8e8',
    WARNING_BORDER: '#e8c98a',
    RUNNING_BG: '#fff4c2',
    TOAST_SUCCESS: '#27ae60',
    TOAST_ERROR: '#e74c3c',
} as const;

// ─── Neutral / UI Colors ───────────────────────────────────────────────────
export const UI = {
    BORDER: '#ccc',
    BORDER_LIGHT: '#ddd',
    BORDER_DIVIDER: '#f0f0f0',
    BORDER_INPUT: '#b9c9d9',
    BORDER_TABLE: '#c8d6e4',
    BORDER_BRAND_LIGHT: '#d8e2ec',
    BORDER_CHROME: '#7892ad',
    TOGGLE_OFF: '#bbb',
    TEXT_BODY: '#333',
    TEXT_SECONDARY: '#666',
    TEXT_MUTED: '#777',
    TEXT_DISABLED: '#555',
    TEXT_UNIT: '#999',
    CARD_BG: '#fafafa',
    BG_INFO: '#f7f9fb',
    WHITE: '#fff',
} as const;

// ─── Shadow Opacities ──────────────────────────────────────────────────────
export const SHADOW = {
    MODAL: 'rgba(0, 0, 0, 0.35)',
    OVERLAY: 'rgba(0, 0, 0, 0.55)',
    TOGGLE: 'rgba(0, 0, 0, 0.25)',
    SUBTLE: 'rgba(0, 0, 0, 0.18)',
    DRAWER: 'rgba(0, 0, 0, 0.22)',
    TOAST: 'rgba(0, 0, 0, 0.3)',
} as const;

// ─── CSS Custom Properties (derived — single source of truth) ──────────────
export const TOKEN_CSS = `/* FFN Enhancements: Design Tokens */
:root {
    --ffne-brand-primary: ${BRAND.PRIMARY};
    --ffne-brand-dark: ${BRAND.DARK};
    --ffne-brand-bg: ${BRAND.BG};
    --ffne-brand-text: ${BRAND.TEXT};
    --ffne-brand-hover-bg: ${BRAND.HOVER_BG};
    --ffne-brand-hover-text: ${BRAND.HOVER_TEXT};
    --ffne-brand-focus-glow: ${BRAND.FOCUS_GLOW};
    --ffne-success-text: ${SEMANTIC.SUCCESS_TEXT};
    --ffne-success-bg: ${SEMANTIC.SUCCESS_BG};
    --ffne-error-text: ${SEMANTIC.ERROR_TEXT};
    --ffne-error-bg: ${SEMANTIC.ERROR_BG};
    --ffne-error-border: ${SEMANTIC.ERROR_BORDER};
    --ffne-warning-text: ${SEMANTIC.WARNING_TEXT};
    --ffne-warning-text-dark: ${SEMANTIC.WARNING_TEXT_DARK};
    --ffne-warning-bg: ${SEMANTIC.WARNING_BG};
    --ffne-warning-border: ${SEMANTIC.WARNING_BORDER};
    --ffne-running-bg: ${SEMANTIC.RUNNING_BG};
    --ffne-toast-success: ${SEMANTIC.TOAST_SUCCESS};
    --ffne-toast-error: ${SEMANTIC.TOAST_ERROR};
    --ffne-border: ${UI.BORDER};
    --ffne-border-light: ${UI.BORDER_LIGHT};
    --ffne-border-divider: ${UI.BORDER_DIVIDER};
    --ffne-border-input: ${UI.BORDER_INPUT};
    --ffne-border-table: ${UI.BORDER_TABLE};
    --ffne-border-brand-light: ${UI.BORDER_BRAND_LIGHT};
    --ffne-border-chrome: ${UI.BORDER_CHROME};
    --ffne-toggle-off: ${UI.TOGGLE_OFF};
    --ffne-text-body: ${UI.TEXT_BODY};
    --ffne-text-secondary: ${UI.TEXT_SECONDARY};
    --ffne-text-muted: ${UI.TEXT_MUTED};
    --ffne-text-disabled: ${UI.TEXT_DISABLED};
    --ffne-text-unit: ${UI.TEXT_UNIT};
    --ffne-card-bg: ${UI.CARD_BG};
    --ffne-bg-info: ${UI.BG_INFO};
    --ffne-white: ${UI.WHITE};
    --ffne-shadow-modal: ${SHADOW.MODAL};
    --ffne-shadow-overlay: ${SHADOW.OVERLAY};
    --ffne-shadow-toggle: ${SHADOW.TOGGLE};
    --ffne-shadow-subtle: ${SHADOW.SUBTLE};
    --ffne-shadow-drawer: ${SHADOW.DRAWER};
    --ffne-shadow-toast: ${SHADOW.TOAST};
}`;
