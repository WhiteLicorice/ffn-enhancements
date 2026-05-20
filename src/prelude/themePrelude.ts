import { Theme } from '../enums/Theme';

export const CRITICAL_THEME_STYLE_ID = 'ffne-theme-critical';
export const THEME_CACHE_KEY = 'ffne_theme_cache';
export const THEME_STORAGE_KEY = 'ffne_theme';
export const PRELUDE_ATTRIBUTE = 'data-ffne-prelude';

interface CriticalThemePreludeConfig {
    styleId: string;
    storageKey: string;
    cacheKey: string;
    preludeAttribute: string;
}

const DEFAULT_CONFIG: CriticalThemePreludeConfig = {
    styleId: CRITICAL_THEME_STYLE_ID,
    storageKey: THEME_STORAGE_KEY,
    cacheKey: THEME_CACHE_KEY,
    preludeAttribute: PRELUDE_ATTRIBUTE,
};

/**
 * Resolves a stored theme preference to a concrete renderable theme.
 * @param selection The stored user preference.
 * @param prefersDark Whether the system prefers a dark color scheme.
 * @returns The resolved theme to apply.
 */
export function resolvePreludeTheme(selection: string | null | undefined, prefersDark: boolean): Theme {
    if (selection === Theme.DARK || selection === Theme.SEPIA || selection === Theme.HIGH_CONTRAST || selection === Theme.LIGHT) {
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

        const isKnownTheme = (value: unknown): value is string => (
            value === 'system'
            || value === 'light'
            || value === 'dark'
            || value === 'sepia'
            || value === 'high-contrast'
        );

        let selectedTheme: string | undefined;
        try {
            const gmGetValue = Reflect.get(globalThis, 'GM_getValue');
            if (typeof gmGetValue === 'function') {
                const rawValue = gmGetValue(config.storageKey);
                if (isKnownTheme(rawValue)) {
                    selectedTheme = rawValue;
                }
            }
        } catch {
        }

        if (!selectedTheme) {
            try {
                const cachedTheme = localStorage.getItem(config.cacheKey);
                if (isKnownTheme(cachedTheme)) {
                    selectedTheme = cachedTheme;
                }
            } catch {
            }
        }

        const resolvedTheme = selectedTheme === 'dark'
            || selectedTheme === 'sepia'
            || selectedTheme === 'high-contrast'
            || selectedTheme === 'light'
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
