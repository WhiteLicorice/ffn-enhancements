import { Theme } from '../enums/Theme';
import { IThemeDefinition } from '../interfaces/IThemeDefinition';
import { buildTokenCss } from '../styles/ThemeTokens';
import { getThemeDefinition } from '../themes';
import { RESOLVED_THEMES, ResolvedTheme, themeClass } from '../utils/themeClass';

const CRITICAL_TOKEN_NAMES = [
    '--ffne-brand-primary',
    '--ffne-brand-dark',
    '--ffne-brand-bg',
    '--ffne-brand-text',
    '--ffne-semantic-success-text',
    '--ffne-semantic-success-bg',
    '--ffne-semantic-success-border',
    '--ffne-semantic-error-text',
    '--ffne-semantic-error-bg',
    '--ffne-semantic-error-border',
    '--ffne-semantic-warning-text',
    '--ffne-semantic-warning-text-dark',
    '--ffne-semantic-warning-bg',
    '--ffne-semantic-warning-border',
    '--ffne-ui-page-bg',
    '--ffne-ui-white',
    '--ffne-ui-card-bg',
    '--ffne-ui-text-body',
    '--ffne-ui-text-secondary',
    '--ffne-ui-border',
    '--ffne-ui-border-light',
    '--ffne-ui-border-input',
    '--ffne-ui-border-table',
    '--ffne-ui-text-on-accent',
] as const;

export function buildCriticalThemeCss(): string {
    const css = RESOLVED_THEMES
        .map(theme => buildCriticalThemeBlock(getThemeDefinition(theme)))
        .join('\n\n');

    return minifyCss(css);
}

function buildCriticalThemeBlock(definition: IThemeDefinition): string {
    const className = themeClass(definition.name);
    const blocks = [
        buildTokenCss(pickCriticalTokens(definition.tokens as Record<string, string>), `html.${className}`),
        buildThemeChromeCss(className, definition.isDark),
    ];

    if (definition.name !== Theme.LIGHT) {
        blocks.push(buildCriticalNativeChromeCss(definition.name as ResolvedTheme));
    }

    return blocks.join('\n\n');
}

function buildThemeChromeCss(className: string, isDark: boolean): string {
    return `
html.${className} {
    color-scheme: ${isDark ? 'dark' : 'light'} !important;
    background: var(--ffne-ui-page-bg) !important;
    color: var(--ffne-ui-text-body) !important;
}
html.${className} body {
    background-color: var(--ffne-ui-page-bg) !important;
    color: var(--ffne-ui-text-body) !important;
}
html.${className} #content_wrapper,
html.${className} #content_wrapper_inner {
    background-color: var(--ffne-ui-page-bg) !important;
    color: var(--ffne-ui-text-body) !important;
}
`.trim();
}

function buildCriticalNativeChromeCss(theme: ResolvedTheme): string {
    const s = `html.${themeClass(theme)}`;

    return `
${s} .xcontrast,
${s} .xcontrast_outer,
${s} #l_main,
${s} #l_menu,
${s} #xcenter,
${s} #content_parent,
${s} .z-top-container,
${s} #review {
    background-color: var(--ffne-ui-page-bg) !important;
    color: var(--ffne-ui-text-body) !important;
}

${s} .xcontrast_txt,
${s} #profile_top,
${s} #storytext,
${s} .storytext,
${s} #storytextp,
${s} p,
${s} li,
${s} label,
${s} span {
    color: var(--ffne-ui-text-body) !important;
}

${s} .xgray {
    color: var(--ffne-ui-text-secondary) !important;
}

${s} a:link,
${s} a:visited {
    color: var(--ffne-brand-primary) !important;
}

${s} a[href*="/u/"],
${s} a[href*="/u/"].xcontrast_txt,
${s} #profile_top a[href*="/r/"],
${s} #profile_top a[href*="/r/"] span,
${s} #profile_top a[href*="/reviews/"],
${s} #profile_top a[href*="/reviews/"] span {
    color: var(--ffne-semantic-warning-text-dark) !important;
}

${s} #top,
${s} .tcat {
    background-color: var(--ffne-brand-dark) !important;
    color: var(--ffne-ui-text-on-accent) !important;
    border-color: var(--ffne-ui-border) !important;
}

${s} .menulink,
${s} .menulink a,
${s} .menulink small,
${s} .lc-left a,
${s} .lc a,
${s} .tcat b,
${s} .tcat a {
    color: var(--ffne-ui-text-on-accent) !important;
}

${s} #name_login a {
    color: #ff9944 !important;
}

${s} table,
${s} #gui_table1,
${s} #gui_table2,
${s} .table,
${s} .table-bordered {
    background-color: var(--ffne-ui-white) !important;
    color: var(--ffne-ui-text-body) !important;
    border-color: var(--ffne-ui-border) !important;
}

${s} td,
${s} #gui_table1 td,
${s} #gui_table2 td {
    background-color: var(--ffne-ui-white) !important;
    color: var(--ffne-ui-text-body) !important;
    border-color: var(--ffne-ui-border-light) !important;
}

${s} th,
${s} #gui_table1 th,
${s} #gui_table2 th {
    background-color: var(--ffne-brand-bg) !important;
    color: var(--ffne-ui-text-body) !important;
    border-color: var(--ffne-ui-border-table) !important;
}

${s} tr:nth-child(even) > td,
${s} .table-striped tbody tr:nth-child(odd) > td,
${s} .table-striped tbody tr:nth-child(odd) > th {
    background-color: var(--ffne-ui-card-bg) !important;
}

${s} input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="image"]),
${s} select,
${s} textarea,
${s} #review_review {
    background-color: var(--ffne-ui-card-bg) !important;
    color: var(--ffne-ui-text-body) !important;
    border-color: var(--ffne-ui-border-input) !important;
}

${s} input[type="submit"],
${s} input[type="button"],
${s} button,
${s} .btn {
    background-color: var(--ffne-brand-bg) !important;
    background-image: none !important;
    color: var(--ffne-brand-text) !important;
    border-color: var(--ffne-ui-border) !important;
    text-shadow: none !important;
}

${s} .panel_normal {
    background-color: var(--ffne-ui-card-bg) !important;
    border-color: var(--ffne-ui-border) !important;
    color: var(--ffne-ui-text-body) !important;
}

${s} .panel_success {
    background-color: var(--ffne-semantic-success-bg) !important;
    border-color: var(--ffne-semantic-success-border) !important;
    color: var(--ffne-semantic-success-text) !important;
}

${s} .panel_warning {
    background-color: var(--ffne-semantic-warning-bg) !important;
    border-color: var(--ffne-semantic-warning-border) !important;
    color: var(--ffne-semantic-warning-text) !important;
}

${s} .panel_error {
    background-color: var(--ffne-semantic-error-bg) !important;
    border-color: var(--ffne-semantic-error-border) !important;
    color: var(--ffne-semantic-error-text) !important;
}
`.trim();
}

function minifyCss(css: string): string {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}:;,>])\s*/g, '$1')
        .replace(/;}/g, '}')
        .trim();
}

function pickCriticalTokens(tokens: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        CRITICAL_TOKEN_NAMES
            .map(name => [name, tokens[name]])
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
}
