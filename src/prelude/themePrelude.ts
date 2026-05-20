import { Theme } from '../enums/Theme';

export const CRITICAL_THEME_STYLE_ID = 'ffne-theme-critical';
export const THEME_CACHE_KEY = 'ffne_theme_cache';
export const THEME_STORAGE_KEY = 'ffne_theme';
export const PRELUDE_ATTRIBUTE = 'data-ffne-prelude';
export const VALID_PRELUDE_THEMES = [Theme.SYSTEM, Theme.LIGHT, Theme.DARK, Theme.SEPIA, Theme.HIGH_CONTRAST] as const;
type ValidPreludeTheme = (typeof VALID_PRELUDE_THEMES)[number];

interface CriticalThemePreludeConfig {
    styleId: string;
    storageKey: string;
    cacheKey: string;
    preludeAttribute: string;
    validThemes: readonly string[];
}

const DEFAULT_CONFIG: CriticalThemePreludeConfig = {
    styleId: CRITICAL_THEME_STYLE_ID,
    storageKey: THEME_STORAGE_KEY,
    cacheKey: THEME_CACHE_KEY,
    preludeAttribute: PRELUDE_ATTRIBUTE,
    validThemes: VALID_PRELUDE_THEMES,
};

/**
 * Resolves a stored theme preference to a concrete renderable theme.
 * @param selection The stored user preference.
 * @param prefersDark Whether the system prefers a dark color scheme.
 * @returns The resolved theme to apply.
 */
export function resolvePreludeTheme(selection: string | null | undefined, prefersDark: boolean): Theme {
    if (isValidPreludeTheme(selection) && selection !== Theme.SYSTEM) {
        return selection;
    }

    return prefersDark ? Theme.DARK : Theme.LIGHT;
}

/**
 * Applies the critical theme class and CSS as early as possible at document-start.
 * @param criticalCss The prebuilt critical CSS payload to inject.
 * @param config Metadata keys used by the sandboxed prelude environment.
 * @returns Nothing; this is designed to run in the isolated userscript prelude context.
 */
export function installCriticalThemePrelude(
    criticalCss: string,
    config: CriticalThemePreludeConfig = DEFAULT_CONFIG,
): void {
    try {
        const FFN_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net']);
        if (!FFN_HOSTS.has(location.hostname)) return;

        const root = document.documentElement;
        if (!root) return;

        const themeClassPrefix = 'ffne-theme-';
        const themeClasses = [
            `${themeClassPrefix}light`,
            `${themeClassPrefix}dark`,
            `${themeClassPrefix}sepia`,
            `${themeClassPrefix}high-contrast`,
        ];
        const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
        const validThemes = config.validThemes;
        const isKnownTheme = (value: unknown): value is string => typeof value === 'string' && validThemes.includes(value);
        const normalizeThemeSelection = (value: unknown): string | undefined => isKnownTheme(value) ? value : undefined;

        let selectedTheme: string | undefined;
        try {
            const gmGetValue = Reflect.get(globalThis, 'GM_getValue');
            if (typeof gmGetValue === 'function') {
                selectedTheme = normalizeThemeSelection(gmGetValue(config.storageKey));
            }
        } catch {
        }

        if (!selectedTheme) {
            try {
                selectedTheme = normalizeThemeSelection(localStorage.getItem(config.cacheKey));
            } catch {
            }
        }

        const resolvedTheme = selectedTheme && selectedTheme !== 'system'
            ? selectedTheme
            : (prefersDark ? 'dark' : 'light');
        const resolvedClass = `${themeClassPrefix}${resolvedTheme}`;

        themeClasses.forEach(themeClassName => root.classList.remove(themeClassName));
        root.classList.add(resolvedClass);
        root.style.colorScheme = (resolvedTheme === 'dark' || resolvedTheme === 'high-contrast') ? 'dark' : 'light';

        let style = document.getElementById(config.styleId) as HTMLStyleElement | null;
        if (!style) {
            style = document.createElement('style');
            style.id = config.styleId;
        }

        style.textContent = criticalCss;
        style.setAttribute(config.preludeAttribute, '');

        const target = document.head || root;
        if (style.parentNode !== target) {
            target.appendChild(style);
        }

        if (!document.head) {
            const observer = new MutationObserver(() => {
                if (!document.head) return;
                const currentStyle = document.getElementById(config.styleId);
                if (currentStyle && currentStyle.parentNode !== document.head) {
                    document.head.appendChild(currentStyle);
                }
                observer.disconnect();
            });
            observer.observe(root, { childList: true });
        }
    } catch {
    }
}

function isValidPreludeTheme(value: unknown): value is ValidPreludeTheme {
    return typeof value === 'string' && (VALID_PRELUDE_THEMES as readonly string[]).includes(value);
}
