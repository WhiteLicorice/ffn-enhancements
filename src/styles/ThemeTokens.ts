export const DEFAULT_TOKENS: Record<string, string> = {
    '--ffne-brand-primary': '#29297a',
    '--ffne-brand-dark': '#1f1f5c',
    '--ffne-brand-bg': '#f0f0f7',
    '--ffne-brand-text': '#1f1f5c',
    '--ffne-brand-hover-bg': '#e6e6f2',
    '--ffne-brand-hover-text': '#15154a',
    '--ffne-brand-focus-glow': 'rgba(41,41,122,.2)',

    '--ffne-semantic-success-text': '#236423',
    '--ffne-semantic-success-bg': '#edf9ed',
    '--ffne-semantic-success-border': '#8fc08f',
    '--ffne-semantic-error-text': '#8b0000',
    '--ffne-semantic-error-bg': '#fff0f0',
    '--ffne-semantic-error-border': '#d8a0a0',
    '--ffne-semantic-warning-text': '#8a5c00',
    '--ffne-semantic-warning-text-dark': '#8a3b00',
    '--ffne-semantic-warning-bg': '#fff8e8',
    '--ffne-semantic-warning-border': '#e8c98a',
    '--ffne-semantic-running-bg': '#fff4c2',
    '--ffne-semantic-toast-success': '#27ae60',
    '--ffne-semantic-toast-error': '#e74c3c',
    '--ffne-semantic-invalid': '#c00',
    '--ffne-semantic-indicator-saved': '#2a7',

    '--ffne-ui-page-bg': '#fff',
    '--ffne-ui-white': '#fff',
    '--ffne-ui-card-bg': '#fafafa',
    '--ffne-ui-info-bg': '#f7f9fb',
    '--ffne-ui-text-body': '#333',
    '--ffne-ui-text-strong': '#111',
    '--ffne-ui-text-secondary': '#666',
    '--ffne-ui-text-muted': '#777',
    '--ffne-ui-text-disabled': '#555',
    '--ffne-ui-text-unit': '#999',
    '--ffne-ui-border-chrome': '#8a8ab5',
    '--ffne-ui-border-muted': '#8a8a8a',
    '--ffne-ui-border': '#ccc',
    '--ffne-ui-border-light': '#ddd',
    '--ffne-ui-border-divider': '#f0f0f0',
    '--ffne-ui-border-input': '#c6c6d6',
    '--ffne-ui-border-table': '#d0d0de',
    '--ffne-ui-border-brand-light': '#dedeeb',
    '--ffne-ui-border-routine': '#d8d8d8',
    '--ffne-ui-toggle-off': '#bbb',

    '--ffne-shadow-modal': 'rgba(0,0,0,.35)',
    '--ffne-shadow-overlay': 'rgba(0,0,0,.55)',
    '--ffne-shadow-toggle': 'rgba(0,0,0,.25)',
    '--ffne-shadow-subtle': 'rgba(0,0,0,.18)',
    '--ffne-shadow-drawer': 'rgba(0,0,0,.22)',
    '--ffne-shadow-toast': 'rgba(0,0,0,.3)',
    '--ffne-shadow-dropdown': 'rgba(0,0,0,.175)',
    '--ffne-shadow-cover': 'rgba(0,0,0,.8)',

    '--ffne-ui-text-on-accent': '#fff',
};

export function buildTokenCss(overrides: Record<string, string> = {}, selector: string = ':root'): string {
    const merged = { ...DEFAULT_TOKENS, ...overrides };
    const declarations = Object.entries(merged)
        .map(([name, value]) => `    ${name}: ${value};`)
        .join('\n');

    return `${selector} {\n${declarations}\n}`;
}
