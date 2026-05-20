import { Theme } from '../enums/Theme';
import { IThemeDefinition } from '../interfaces/IThemeDefinition';
import { buildTokenCss } from '../styles/ThemeTokens';
import { getThemeDefinition } from '../themes';
import { FFNE_UI_EXCLUDE_SELECTOR } from '../utils/ffneUi';
import { scopeCssText } from '../utils/scopeCssText';
import { RESOLVED_THEMES, ResolvedTheme, themeClass } from '../utils/themeClass';

export function buildCriticalThemeCss(nativeOverrideStyles: string): string {
    return RESOLVED_THEMES
        .map(theme => buildCriticalThemeBlock(getThemeDefinition(theme), nativeOverrideStyles))
        .join('\n\n');
}

function buildCriticalThemeBlock(definition: IThemeDefinition, nativeOverrideStyles: string): string {
    const className = themeClass(definition.name);
    const blocks = [
        buildTokenCss(definition.tokens as Record<string, string>, `html.${className}`),
        buildThemeChromeCss(className, definition.isDark),
    ];

    if (definition.name !== Theme.LIGHT) {
        blocks.push(buildScopedNativeOverrides(nativeOverrideStyles, definition.name as ResolvedTheme));
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

function buildScopedNativeOverrides(nativeOverrideStyles: string, theme: ResolvedTheme): string {
    return scopeCssText(
        nativeOverrideStyles.replace(/__THEME_CLASS__/g, themeClass(theme)),
        '',
        { excludeSelector: FFNE_UI_EXCLUDE_SELECTOR },
    );
}
