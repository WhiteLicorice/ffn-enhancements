import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../bootstrap';
import { Core } from '../modules/Core';
import { EarlyBoot } from '../modules/EarlyBoot';
import { StoryDownloader } from '../modules/StoryDownloader';
import { StoryReader } from '../modules/StoryReader';
import { ThemeManager } from '../modules/ThemeManager';

declare const jsdom: { reconfigure(options: { url: string }): void };

describe('bootstrap', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.head.innerHTML = '';
        document.body.innerHTML = '';
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/' });
    });

    it('runs story route init after EarlyBoot init has ensured component styles', () => {
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/s/123/1/Test' });
        vi.spyOn(Core, 'startup').mockImplementation(() => {});
        vi.spyOn(EarlyBoot, 'init').mockImplementation(() => {
            ThemeManager.ensureComponentStyles();
        });
        vi.spyOn(StoryReader, 'init').mockImplementation(() => {});
        vi.spyOn(StoryDownloader, 'init').mockImplementation(() => {
            expect(document.getElementById('ffne-component-styles')).not.toBeNull();
            const container = document.createElement('div');
            container.className = 'ffne-dl-container';
            document.body.appendChild(container);
        });

        bootstrap(window.location);

        expect(document.querySelector('.ffne-dl-container')).not.toBeNull();
    });
});
