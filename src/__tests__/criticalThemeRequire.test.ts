// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Theme } from '../enums/Theme';
import {
    CRITICAL_THEME_DECODED_SIZE_BUDGET,
    CRITICAL_THEME_METADATA_LINE_BUDGET,
    makeCriticalThemeRequire,
} from '../../vite.config';

function createPreludeDom(html: string = '<!doctype html><html><head></head><body></body></html>') {
    return new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'https://www.fanfiction.net/s/1/1/Test',
    });
}

describe('critical theme require payload', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds one compact data require payload within the size budget', () => {
        const requireValue = makeCriticalThemeRequire();
        const decodedPayload = decodeURIComponent(requireValue.replace('data:application/javascript,', ''));

        expect(requireValue.startsWith('data:application/javascript,')).toBe(true);
        expect(Buffer.byteLength(decodedPayload, 'utf8')).toBeLessThan(CRITICAL_THEME_DECODED_SIZE_BUDGET);
        expect(`// @require      ${requireValue}`.length).toBeLessThan(CRITICAL_THEME_METADATA_LINE_BUDGET);
        expect(decodedPayload).toContain('ffne-theme-critical');
        expect(decodedPayload).toContain('ffne_theme_cache');
    });

    it('executes the decoded payload and injects the expected theme class and style', () => {
        const requireValue = makeCriticalThemeRequire();
        const decodedPayload = decodeURIComponent(requireValue.replace('data:application/javascript,', ''));
        const dom = createPreludeDom('<!doctype html><html><body></body></html>');

        dom.window.document.head.remove();
        dom.window.matchMedia = vi.fn().mockReturnValue({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        Object.assign(dom.window, {
            GM_getValue: vi.fn(() => Theme.SEPIA),
        });

        dom.window.eval(decodedPayload);

        const style = dom.window.document.getElementById('ffne-theme-critical');
        expect(dom.window.document.documentElement.classList.contains('ffne-theme-sepia')).toBe(true);
        expect(style).not.toBeNull();
        expect(style?.getAttribute('data-ffne-prelude')).toBe('');
    });
});
