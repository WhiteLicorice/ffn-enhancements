// Deprecated reference tokens for FFN Enhancements UI.
// Runtime styling now uses CSS custom properties from ThemeTokens.ts.
//
// Reusable design tokens for FFN Enhancements UI.
// Values drawn from FFN's native colour palette for visual consistency.
// Used via template literals in injected <style> blocks — no CSS custom
// properties, no runtime injection step.

// ─── Brand (FFN navy family) ──────────────────────────────────────────────

// Derived from FFN primary: hsl(240, 50%, 32%) → #29297a
export const BRAND = {
    PRIMARY: '#29297a',
    DARK: '#1f1f5c',
    BG: '#f0f0f7',
    TEXT: '#1f1f5c',
    HOVER_BG: '#e6e6f2',
    HOVER_TEXT: '#15154a',
    FOCUS_GLOW: 'rgba(41,41,122,.2)',
} as const;

// ─── Semantic / Status ────────────────────────────────────────────────────

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
    INVALID: '#c00',
    INDICATOR_SAVED: '#2a7',
} as const;

// ─── Chrome / Surfaces / Text ─────────────────────────────────────────────

export const UI = {
    BORDER_CHROME: '#8a8ab5',
    BORDER: '#ccc',
    BORDER_LIGHT: '#ddd',
    BORDER_DIVIDER: '#f0f0f0',
    BORDER_INPUT: '#c6c6d6',
    BORDER_TABLE: '#d0d0de',
    BORDER_BRAND_LIGHT: '#dedeeb',
    BORDER_ROUTINE: '#d8d8d8',
    TOGGLE_OFF: '#bbb',
    TEXT_BODY: '#333',
    TEXT_SECONDARY: '#666',
    TEXT_MUTED: '#777',
    TEXT_DISABLED: '#555',
    TEXT_UNIT: '#999',
    CARD_BG: '#fafafa',
    INFO_BG: '#f7f9fb',
    WHITE: '#fff',
} as const;

// ─── Shadow Opacities ─────────────────────────────────────────────────────

export const SHADOW = {
    MODAL: 'rgba(0,0,0,.35)',
    OVERLAY: 'rgba(0,0,0,.55)',
    TOGGLE: 'rgba(0,0,0,.25)',
    SUBTLE: 'rgba(0,0,0,.18)',
    DRAWER: 'rgba(0,0,0,.22)',
    TOAST: 'rgba(0,0,0,.3)',
} as const;
