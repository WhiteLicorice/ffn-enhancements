import { afterEach, describe, expect, it, vi } from 'vitest';
import { Theme } from '../enums/Theme';
import { ThemeManager } from '../modules/ThemeManager';
import { SettingsManager } from '../modules/SettingsManager';

function resetDom(): void {
    document.documentElement.innerHTML = '<head></head><body></body>';
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
}

describe('ThemeManager', () => {
    afterEach(() => {
        resetDom();
        vi.restoreAllMocks();
    });

    it.each([Theme.DARK, Theme.HIGH_CONTRAST])(
        'prime injects static native overrides for %s before init',
        (theme) => {
            resetDom();
            vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
                if (key === 'theme') return theme;
                return undefined as never;
            });

            ThemeManager.prime();

            expect(Array.from(document.querySelectorAll('style')).map(style => style.id)).toEqual([
                'ffne-theme-tokens',
                'ffne-theme-native-overrides',
                'ffne-component-styles',
            ]);
            expect(document.getElementById('ffne-theme-native-overrides')?.textContent).toContain(':not([data-ffne-ui])');
            expect(document.getElementById('ffne-theme-ffn-overrides')).toBeNull();
        },
    );
});
