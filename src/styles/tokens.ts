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
    TOGGLE_OFF: '#bbb',
    TEXT_BODY: '#333',
    TEXT_SECONDARY: '#666',
    TEXT_MUTED: '#777',
    TEXT_DISABLED: '#555',
    TEXT_UNIT: '#999',
    CARD_BG: '#fafafa',
    WHITE: '#fff',
} as const;

// ─── Shadow Opacities ──────────────────────────────────────────────────────
export const SHADOW = {
    MODAL: 'rgba(0, 0, 0, 0.35)',
    OVERLAY: 'rgba(0, 0, 0, 0.55)',
    TOGGLE: 'rgba(0, 0, 0, 0.25)',
    DROPDOWN: 'rgba(0, 0, 0, 0.15)',
    DROPDOWN_STRONG: 'rgba(0, 0, 0, 0.175)',
    SUBTLE: 'rgba(0, 0, 0, 0.18)',
    DRAWER: 'rgba(0, 0, 0, 0.22)',
    TOAST: 'rgba(0, 0, 0, 0.3)',
    IMAGE_MODAL: 'rgba(0, 0, 0, 0.8)',
} as const;
