import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Theme } from '../enums/Theme';
import { ThemeManager } from '../modules/ThemeManager';
import { SettingsManager } from '../modules/SettingsManager';
import { themeClass } from '../utils/themeClass';

declare const jsdom: { reconfigure(options: { url: string }): void };

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
        'prime only reconciles theme chrome for %s and keeps the critical prelude intact',
        (theme) => {
            resetDom();
            jsdom.reconfigure({ url: 'https://www.fanfiction.net/docs/docs.php' });
            vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
                if (key === 'theme') return theme;
                return undefined as never;
            });
            const criticalStyle = document.createElement('style');
            criticalStyle.id = 'ffne-theme-critical';
            document.head.appendChild(criticalStyle);

            ThemeManager.prime();

            expect(document.documentElement.classList.contains(themeClass(theme))).toBe(true);
            expect(document.documentElement.style.colorScheme).toBe('dark');
            expect(document.getElementById('ffne-theme-critical')).toBe(criticalStyle);
            expect(document.getElementById('ffne-theme-tokens')).toBeNull();
            expect(document.getElementById('ffne-theme-native-overrides')).toBeNull();
            expect(document.getElementById('ffne-theme-scanned-ffn-overrides')).toBeNull();
            expect(document.getElementById('ffne-component-styles')).toBeNull();
        },
    );

    it('init injects full theme styles and component styles for late FFNE download UI', () => {
        resetDom();
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/s/1/1/Test' });
        vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
            if (key === 'theme') return Theme.DARK;
            return undefined as never;
        });

        ThemeManager.prime();
        ThemeManager.init();

        const container = document.createElement('div');
        container.setAttribute('data-ffne-ui', '');
        container.className = 'ffne-dl-container';
        const button = document.createElement('button');
        button.className = 'btn';
        container.appendChild(button);
        document.body.appendChild(container);

        expect(document.getElementById('ffne-component-styles')).not.toBeNull();
        expect(document.getElementById('ffne-theme-tokens')).not.toBeNull();
        expect(document.getElementById('ffne-theme-native-overrides')).not.toBeNull();
        expect(componentStyles).toContain('.ffne-dl-container');
        expect(componentStyles).toContain('[data-ffne-ui].ffne-dl-container > .btn');
        expect(componentStyles).toContain('background-image: none !important');
        expect(document.querySelector('[data-ffne-ui].ffne-dl-container .btn')).toBe(button);
    });

    it('ensureComponentStyles is idempotent', () => {
        resetDom();
        ThemeManager.ensureComponentStyles();
        ThemeManager.ensureComponentStyles();

        expect(document.querySelectorAll('#ffne-component-styles')).toHaveLength(1);
    });

    it('does not inject FFN native overrides outside FFN hosts during init', () => {
        resetDom();
        jsdom.reconfigure({ url: 'https://archiveofourown.org/works/1' });
        vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
            if (key === 'theme') return Theme.DARK;
            return undefined as never;
        });

        ThemeManager.prime();
        ThemeManager.init();

        expect(document.getElementById('ffne-theme-tokens')).not.toBeNull();
        expect(document.getElementById('ffne-component-styles')).not.toBeNull();
        expect(document.getElementById('ffne-theme-native-overrides')).toBeNull();
        expect(document.documentElement.classList.contains('ffne-theme-dark')).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe('dark');
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
