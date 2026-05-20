import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../bootstrap';
import { Core } from '../modules/Core';
import { EarlyBoot } from '../modules/EarlyBoot';
import { PaintGate } from '../modules/PaintGate';
import { StoryDownloader } from '../modules/StoryDownloader';
import { StoryReader } from '../modules/StoryReader';

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

    it('releases the paint gate after story route init inserts the downloader UI', () => {
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/s/123/1/Test' });
        vi.spyOn(Core, 'startup').mockImplementation(() => {});
        vi.spyOn(EarlyBoot, 'init').mockImplementation(() => {});
        vi.spyOn(StoryReader, 'init').mockImplementation(() => {});
        vi.spyOn(StoryDownloader, 'init').mockImplementation(() => {
            const container = document.createElement('div');
            container.className = 'ffne-dl-container';
            document.body.appendChild(container);
        });
        const releaseSpy = vi.spyOn(PaintGate, 'releaseAfterPaint').mockImplementation(() => {
            expect(document.querySelector('.ffne-dl-container')).not.toBeNull();
        });

        bootstrap(window.location);

        expect(releaseSpy).toHaveBeenCalledOnce();
    });
});
