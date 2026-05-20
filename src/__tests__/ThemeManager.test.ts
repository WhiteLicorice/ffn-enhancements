import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Theme } from '../enums/Theme';
import { ThemeManager } from '../modules/ThemeManager';
import { SettingsManager } from '../modules/SettingsManager';

declare const jsdom: { reconfigure(options: { url: string }): void };

const nativeOverrideStyles = readFileSync(join(process.cwd(), 'src/styles/native-overrides.css'), 'utf8');
const componentStyles = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8');

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

            const tokenStyle = document.getElementById('ffne-theme-tokens');
            const nativeStyle = document.getElementById('ffne-theme-native-overrides');
            expect(Array.from(document.querySelectorAll('style')).map(style => style.id)).toEqual([
                'ffne-theme-tokens',
                'ffne-theme-native-overrides',
                'ffne-component-styles',
            ]);
            expect(tokenStyle?.textContent).toContain('--ffne-semantic-warning-text-dark');
            expect(nativeOverrideStyles).toContain('#profile_top a[href*="/r/"]');
            expect(nativeOverrideStyles).toContain('.panel_success');
            expect(nativeOverrideStyles).toContain('--ffne-semantic-success-border');
            expect(componentStyles).toContain('.ffne-dl-container');
            expect(nativeStyle).not.toBeNull();
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
        expect(document.documentElement.className).toBe('');
        expect(document.documentElement.style.colorScheme).toBe('');
    });

    it('does not theme AO3 TinyMCE iframes or leave old iframe theme hooks behind', () => {
        resetDom();
        jsdom.reconfigure({ url: 'https://archiveofourown.org/works/1/chapters/2/edit' });
        vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
            if (key === 'theme') return Theme.DARK;
            return undefined as never;
        });

        const iframe = document.createElement('iframe');
        iframe.id = 'content_ifr';
        document.body.appendChild(iframe);
        const frameDocument = iframe.contentDocument!;
        frameDocument.documentElement.classList.add('ffne-theme-dark');
        frameDocument.documentElement.style.colorScheme = 'dark';
        const oldTokenStyle = frameDocument.createElement('style');
        oldTokenStyle.id = 'ffne-theme-tokens';
        oldTokenStyle.textContent = 'html.ffne-theme-dark body { background: black !important; }';
        frameDocument.head.appendChild(oldTokenStyle);

        ThemeManager.prime();
        ThemeManager.init();

        expect(frameDocument.documentElement.className).toBe('');
        expect(frameDocument.documentElement.style.colorScheme).toBe('');
        expect(frameDocument.getElementById('ffne-theme-tokens')).toBeNull();
        expect(frameDocument.getElementById('ffne-theme-iframe-native-overrides')).toBeNull();
        expect(frameDocument.getElementById('ffne-theme-iframe-overrides')).toBeNull();
    });
});
