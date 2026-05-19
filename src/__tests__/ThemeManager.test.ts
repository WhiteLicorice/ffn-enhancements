import { afterEach, describe, expect, it, vi } from 'vitest';
import { Theme } from '../enums/Theme';
import { ThemeManager } from '../modules/ThemeManager';
import { SettingsManager } from '../modules/SettingsManager';

declare const jsdom: { reconfigure(options: { url: string }): void };

function resetDom(): void {
    document.documentElement.innerHTML = '<head></head><body></body>';
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
}

describe('ThemeManager', () => {
    afterEach(() => {
        resetDom();
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/' });
        vi.restoreAllMocks();
    });

    it.each([Theme.DARK, Theme.HIGH_CONTRAST])(
        'prime injects static native overrides for %s before init',
        (theme) => {
            resetDom();
            jsdom.reconfigure({ url: 'https://www.fanfiction.net/docs/docs.php' });
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
            expect(document.getElementById('ffne-theme-native-overrides')).not.toBeNull();
            expect(document.getElementById('ffne-theme-scanned-ffn-overrides')).toBeNull();
        },
    );

    it('does not inject FFN native overrides outside FFN hosts', () => {
        resetDom();
        jsdom.reconfigure({ url: 'https://archiveofourown.org/works/1' });
        vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
            if (key === 'theme') return Theme.DARK;
            return undefined as never;
        });

        ThemeManager.prime();

        expect(document.getElementById('ffne-theme-tokens')).not.toBeNull();
        expect(document.getElementById('ffne-component-styles')).not.toBeNull();
        expect(document.getElementById('ffne-theme-native-overrides')).toBeNull();
    });
});
