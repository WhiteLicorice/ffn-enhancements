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
    const css = [
        ...RESOLVED_THEMES.map(theme => buildCriticalTokenCss(getThemeDefinition(theme))),
        buildThemeChromeCss(),
        buildCriticalNativeChromeCss(),
    ].join('\n\n');

    return minifyCss(css);
}

function buildCriticalTokenCss(definition: IThemeDefinition): string {
    const className = themeClass(definition.name);
    return buildTokenCss(pickCriticalTokens(definition.tokens as Record<string, string>), `html.${className}`);
}

function buildThemeChromeCss(): string {
    const lightRoot = scopedThemeSelector([Theme.LIGHT]);
    const darkRoot = scopedThemeSelector([Theme.DARK, Theme.SEPIA, Theme.HIGH_CONTRAST]);
    const allRoots = scopedThemeSelector(RESOLVED_THEMES);

    return `
 ${lightRoot} {
     color-scheme: light !important;
 }
 ${darkRoot} {
     color-scheme: dark !important;
 }
 ${allRoots} {
     background: var(--ffne-ui-page-bg) !important;
     color: var(--ffne-ui-text-body) !important;
 }
 ${allRoots} body {
     background-color: var(--ffne-ui-page-bg) !important;
     color: var(--ffne-ui-text-body) !important;
 }
 ${allRoots} :is(#content_wrapper,#content_wrapper_inner) {
     background-color: var(--ffne-ui-page-bg) !important;
     color: var(--ffne-ui-text-body) !important;
 }
 `.trim();
}

function buildCriticalNativeChromeCss(): string {
    const s = scopedThemeSelector([Theme.DARK, Theme.SEPIA, Theme.HIGH_CONTRAST]);

    return `
${s} :is(.xcontrast,.xcontrast_outer,#l_main,#l_menu,#xcenter,#content_parent,.z-top-container,#review) {
    background-color: var(--ffne-ui-page-bg) !important;
    color: var(--ffne-ui-text-body) !important;
}

${s} :is(.xcontrast_txt,#profile_top,#storytext,.storytext,#storytextp,p,li,label,span) {
    color: var(--ffne-ui-text-body) !important;
}

${s} .xgray {
    color: var(--ffne-ui-text-secondary) !important;
}

${s} :is(a:link,a:visited) {
    color: var(--ffne-brand-primary) !important;
}

${s} :is(a[href*="/u/"],a[href*="/u/"].xcontrast_txt,#profile_top a[href*="/r/"],#profile_top a[href*="/r/"] span,#profile_top a[href*="/reviews/"],#profile_top a[href*="/reviews/"] span) {
    color: var(--ffne-semantic-warning-text-dark) !important;
}

${s} :is(#top,.tcat) {
    background-color: var(--ffne-brand-dark) !important;
    color: var(--ffne-ui-text-on-accent) !important;
    border-color: var(--ffne-ui-border) !important;
}

${s} :is(.menulink,.menulink a,.menulink small,.lc-left a,.lc a,.tcat b,.tcat a) {
    color: var(--ffne-ui-text-on-accent) !important;
}

${s} #name_login a {
    color: #ff9944 !important;
}

${s} :is(table,#gui_table1,#gui_table2,.table,.table-bordered) {
    background-color: var(--ffne-ui-white) !important;
    color: var(--ffne-ui-text-body) !important;
    border-color: var(--ffne-ui-border) !important;
}

${s} :is(td,#gui_table1 td,#gui_table2 td) {
    background-color: var(--ffne-ui-white) !important;
    color: var(--ffne-ui-text-body) !important;
    border-color: var(--ffne-ui-border-light) !important;
}

${s} :is(th,#gui_table1 th,#gui_table2 th) {
    background-color: var(--ffne-brand-bg) !important;
    color: var(--ffne-ui-text-body) !important;
    border-color: var(--ffne-ui-border-table) !important;
}

${s} :is(tr:nth-child(even)>td,.table-striped tbody tr:nth-child(odd)>td,.table-striped tbody tr:nth-child(odd)>th) {
    background-color: var(--ffne-ui-card-bg) !important;
}

${s} :is(input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="image"]),select,textarea,#review_review) {
    background-color: var(--ffne-ui-card-bg) !important;
    color: var(--ffne-ui-text-body) !important;
    border-color: var(--ffne-ui-border-input) !important;
}

${s} :is(input[type="submit"],input[type="button"],button,.btn) {
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

function scopedThemeSelector(themes: readonly ResolvedTheme[]): string {
    return themes.length === 1
        ? `html.${themeClass(themes[0])}`
        : `html:is(${themes.map(theme => `.${themeClass(theme)}`).join(',')})`;
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
