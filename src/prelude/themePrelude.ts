// Extension theme prelude — runs at document_start via manifest content_scripts.
// CSS for all themes is already injected by the browser via manifest css[].
// This script only reads localStorage and applies the correct theme class.

const CACHE_KEY = 'ffne_theme_cache';
const Theme = {
    SYSTEM: 'system',
    LIGHT: 'light',
    DARK: 'dark',
    SEPIA: 'sepia',
    HIGH_CONTRAST: 'high-contrast',
} as const;
const VALID_THEMES: readonly string[] = Object.values(Theme);
const THEME_CLASS_PREFIX = 'ffne-theme-';

(function applyThemePrelude(): void {
    try {
        const FFN_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net']);
        if (!FFN_HOSTS.has(location.hostname)) return;

        const root = document.documentElement;
        if (!root) return;

        const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

        let selected: string | null = null;
        try { selected = localStorage.getItem(CACHE_KEY); } catch { /* ignore */ }

        const isValid = typeof selected === 'string' && (VALID_THEMES as readonly string[]).includes(selected);
        const resolved: string = (isValid && selected !== null && selected !== Theme.SYSTEM)
            ? selected
            : (prefersDark ? Theme.DARK : Theme.LIGHT);

        // Remove all theme classes, then add the resolved one.
        for (const t of VALID_THEMES) {
            root.classList.remove(themeClass(t));
        }
        root.classList.add(themeClass(resolved));

        // Set color-scheme for browser chrome (scrollbars, etc.).
        root.style.colorScheme = (resolved === Theme.DARK || resolved === Theme.HIGH_CONTRAST) ? 'dark' : 'light';
    } catch {
        // Silently degrade — page renders with FFN defaults.
    }
})();

function themeClass(theme: string): string {
    return `${THEME_CLASS_PREFIX}${theme}`;
}
