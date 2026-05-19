import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CssScanner } from '../services/CssScanner';

describe('CssScanner', () => {
    beforeEach(() => {
        CssScanner.clearCache();
        document.head.innerHTML = '';
        document.body.innerHTML = '';
    });

    afterEach(() => {
        CssScanner.clearCache();
        document.head.innerHTML = '';
        document.body.innerHTML = '';
    });

    it('generates scoped overrides for mapped colors', () => {
        const style = document.createElement('style');
        style.textContent = `
            .native-panel {
                color: #333;
                background-color: rgb(255, 255, 255);
                box-shadow: 0 1px 2px rgba(0, 0, 0, .25);
            }
        `;
        document.head.appendChild(style);

        const css = CssScanner.scanAndOverride({
            '#333': '#eee',
            '#fff': '#111',
            '#000': '#222',
        }, 'ffne-theme-dark');

        expect(css).toContain('html.ffne-theme-dark .native-panel');
        expect(css).toContain('color: #eeeeee;');
        expect(css).toContain('background-color: #111111;');
        expect(css).toContain('box-shadow: 0 1px 2px rgba(34, 34, 34, 0.25);');
    });

    it('skips FFN Enhancements style tags', () => {
        const style = document.createElement('style');
        style.id = 'ffne-component-styles';
        style.textContent = '.ffne-panel { color: #333; }';
        document.head.appendChild(style);

        const css = CssScanner.scanAndOverride({ '#333': '#eee' }, 'ffne-theme-dark');

        expect(css).toBe('');
    });
});
