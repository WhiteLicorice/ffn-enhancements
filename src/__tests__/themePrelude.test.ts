import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Theme } from '../enums/Theme';
import { buildCriticalThemeCss } from '../build/criticalThemeCss';
import { installCriticalThemePrelude, resolvePreludeTheme } from '../prelude/themePrelude';

declare const jsdom: { reconfigure(options: { url: string }): void };

const nativeOverrideStyles = readFileSync(join(process.cwd(), 'src/styles/native-overrides.css'), 'utf8');
const criticalCss = buildCriticalThemeCss(nativeOverrideStyles);

function resetDom(html: string = '<head></head><body></body>'): void {
    document.documentElement.innerHTML = html;
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
    window.localStorage.clear();
    delete (globalThis as typeof globalThis & { GM_getValue?: unknown }).GM_getValue;
}

function mockMatchMedia(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn().mockReturnValue({
            matches,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }),
    });
}

describe('theme prelude', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        resetDom();
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/' });
    });

    it('inserts the critical style under html before head exists and moves it into head later', async () => {
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/s/1/1/Test' });
        resetDom('<body></body>');
        document.head.remove();
        mockMatchMedia(false);
        (globalThis as typeof globalThis & { GM_getValue?: (key: string) => string }).GM_getValue = vi.fn(() => Theme.DARK);

        installCriticalThemePrelude(criticalCss);

        const style = document.getElementById('ffne-theme-critical');
        expect(style?.parentElement).toBe(document.documentElement);
        expect(style?.getAttribute('data-ffne-prelude')).toBe('');
        expect(document.documentElement.classList.contains('ffne-theme-dark')).toBe(true);

        const head = document.createElement('head');
        document.documentElement.insertBefore(head, document.body);

        await vi.waitFor(() => {
            expect(style?.parentElement).toBe(document.head);
        });
    });

    it.each([
        [Theme.DARK, false, 'ffne-theme-dark'],
        [Theme.SEPIA, false, 'ffne-theme-sepia'],
        [Theme.HIGH_CONTRAST, false, 'ffne-theme-high-contrast'],
        [Theme.LIGHT, true, 'ffne-theme-light'],
        [Theme.SYSTEM, true, 'ffne-theme-dark'],
    ])('resolves %s to %s', (selectedTheme, prefersDark, expectedClass) => {
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/docs/docs.php' });
        resetDom();
        mockMatchMedia(prefersDark);
        (globalThis as typeof globalThis & { GM_getValue?: (key: string) => string }).GM_getValue = vi.fn(() => selectedTheme);

        installCriticalThemePrelude(criticalCss);

        expect(document.documentElement.className).toBe(expectedClass);
    });

    it('falls back to the localStorage theme cache when GM_getValue is unavailable', () => {
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/docs/docs.php' });
        resetDom();
        mockMatchMedia(false);
        window.localStorage.setItem('ffne_theme_cache', Theme.HIGH_CONTRAST);

        installCriticalThemePrelude(criticalCss);

        expect(document.documentElement.className).toBe('ffne-theme-high-contrast');
    });

    it('builds critical CSS with native FFN selectors but without FFNE component selectors', () => {
        expect(resolvePreludeTheme(Theme.SYSTEM, true)).toBe(Theme.DARK);
        expect(resolvePreludeTheme(Theme.SYSTEM, false)).toBe(Theme.LIGHT);
        expect(criticalCss).toContain('.panel_success');
        expect(criticalCss).toContain('#profile_top a[href*="/r/"]');
        expect(criticalCss).toContain('html.ffne-theme-dark body');
        expect(criticalCss).toContain('input:not([type="checkbox"])');
        expect(criticalCss).toContain('html.ffne-theme-dark button');
        expect(criticalCss).toContain('#content_parent');
        expect(criticalCss).not.toContain('.ffne-dl-container');
        expect(criticalCss).not.toContain('[data-ffne-ui].ffne-dl-container');
    });
});
