import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayoutManager } from '../modules/LayoutManager';
import { SettingsManager } from '../modules/SettingsManager';

function resetDom(html: string): void {
    document.documentElement.innerHTML = html;
    document.documentElement.className = '';
}

describe('LayoutManager', () => {
    afterEach(() => {
        resetDom('<head></head><body></body>');
        vi.restoreAllMocks();
    });

    it('applies the fluid mode class to html during prime without requiring body', () => {
        resetDom('<head></head>');
        vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
            if (key === 'fluidMode') return true as never;
            return undefined as never;
        });

        expect(() => LayoutManager.prime()).not.toThrow();

        expect(document.body).toBeNull();
        expect(document.documentElement.classList.contains('ffn-enhancements-fluid-mode')).toBe(true);
        expect(document.getElementById('ffn-enhancements-layout-styles')).not.toBeNull();
    });
});
