import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/fetchRequest', () => ({
    fetchRequestText: vi.fn(),
}));

vi.mock('../modules/EpubBuilder', () => ({
    EpubBuilder: {
        build: vi.fn(),
    },
}));

vi.mock('../utils/confirmDialog', () => ({
    confirmRetryDialog: vi.fn(),
}));

import { EpubBuilder } from '../modules/EpubBuilder';
import { Core } from '../modules/Core';
import { StoryDelegate } from '../delegates/StoryDelegate';
import { SettingsManager } from '../modules/SettingsManager';
import {
    _fetchChapter,
    _runScraper,
} from '../modules/NativeDownloader';
import { fetchRequestText } from '../utils/fetchRequest';
import { confirmRetryDialog } from '../utils/confirmDialog';

const fetchRequestTextMock = vi.mocked(fetchRequestText);
const buildMock = vi.mocked(EpubBuilder.build);
const confirmRetryDialogMock = vi.mocked(confirmRetryDialog);

function storyPageHtml(content?: string): string {
    return `<div id="storytext">${content || '<p>Chapter body</p>'}</div>`;
}

function missingStoryPageHtml(): string {
    return '<div id="other">Missing story</div>';
}

function okResponse(html: string) {
    return {
        ok: true,
        status: 200,
        responseText: html,
        finalUrl: 'https://www.fanfiction.net/s/1/1/',
        isCfChallenge: false,
    };
}

describe('NativeDownloader retry flow', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        fetchRequestTextMock.mockReset();
        buildMock.mockReset();
        confirmRetryDialogMock.mockReset();
        Core.activeDelegate = StoryDelegate;
        vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
            switch (key) {
                case 'chapterFetchMaxRetries':
                    return 1 as never;
                case 'chapterRetryBaseMs':
                    return 0 as never;
                case 'chapterFetchTimeoutMs':
                    return 1000 as never;
                case 'chapterPass1DelayMs':
                case 'chapterCooldownMs':
                case 'chapterPass2DelayMs':
                    return 0 as never;
                default:
                    return 0 as never;
            }
        });
    });

    it('retries a 200 response with missing story text before failing', async () => {
        fetchRequestTextMock
            .mockResolvedValueOnce(okResponse(missingStoryPageHtml()))
            .mockResolvedValueOnce(okResponse(storyPageHtml('<p>Recovered</p>')));

        await expect(_fetchChapter('1', '1', 1)).resolves.toContain('Recovered');
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(2);
    });

    it('fills pass-1 failures during pass-2 retries and preserves chapter order', async () => {
        const localMetaSerializer = {
            serialize: vi.fn().mockResolvedValue({
                id: '1',
                title: 'Story Title',
                author: 'Author',
                description: 'Summary',
                source: 'FanFiction.net',
                storyUrl: 'https://www.fanfiction.net/s/1/1/',
            }),
            getChapterCount: vi.fn().mockReturnValue(4),
        } as never;

        document.body.innerHTML = `
            <select id="chap_select">
                <option value="1">Chapter 1</option>
                <option value="2">Chapter 2</option>
                <option value="3">Chapter 3</option>
                <option value="4">Chapter 4</option>
            </select>
        `;
        vi.mocked(SettingsManager.get).mockImplementation((key) => {
            switch (key) {
                case 'chapterFetchMaxRetries':
                    return 0 as never;
                case 'chapterRetryBaseMs':
                    return 0 as never;
                case 'chapterFetchTimeoutMs':
                    return 1000 as never;
                case 'chapterPass1DelayMs':
                case 'chapterCooldownMs':
                case 'chapterPass2DelayMs':
                    return 0 as never;
                default:
                    return 0 as never;
            }
        });
        const attempts = new Map<string, number>();

        fetchRequestTextMock.mockImplementation(async ({ url }) => {
            if (url.endsWith('/1/')) return okResponse(storyPageHtml('<p>One</p>'));
            if (url.endsWith('/2/')) {
                const attempt = (attempts.get(url) || 0) + 1;
                attempts.set(url, attempt);
                return attempt === 1
                    ? okResponse(missingStoryPageHtml())
                    : okResponse(storyPageHtml('<p>Two</p>'));
            }
            if (url.endsWith('/3/')) return okResponse(storyPageHtml('<p>Three</p>'));
            if (url.endsWith('/4/')) {
                const attempt = (attempts.get(url) || 0) + 1;
                attempts.set(url, attempt);
                return attempt === 1
                    ? {
                        ok: false,
                        status: 503,
                        responseText: '',
                        finalUrl: url,
                        reason: 'HTTP 503',
                        isCfChallenge: false,
                    }
                    : okResponse(storyPageHtml('<p>Four</p>'));
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        await _runScraper('1', 'https://www.fanfiction.net/s/1/1/', localMetaSerializer);

        expect(buildMock).toHaveBeenCalledTimes(1);
        const [, chapters] = buildMock.mock.calls[0];
        expect(chapters.map(chapter => chapter.number)).toEqual([1, 2, 3, 4]);
        expect(chapters.map(chapter => chapter.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4']);
        expect(chapters.map(chapter => chapter.content)).toEqual([
            '<p>One</p>',
            '<p>Two</p>',
            '<p>Three</p>',
            '<p>Four</p>',
        ]);
        expect(confirmRetryDialogMock).not.toHaveBeenCalled();
    });

    it('builds placeholders when the user chooses to continue after retry exhaustion', async () => {
        const localMetaSerializer = {
            serialize: vi.fn().mockResolvedValue({
                id: '1',
                title: 'Story Title',
                author: 'Author',
                description: 'Summary',
                source: 'FanFiction.net',
                storyUrl: 'https://www.fanfiction.net/s/1/1/',
            }),
            getChapterCount: vi.fn().mockReturnValue(2),
        } as never;

        document.body.innerHTML = `
            <select id="chap_select">
                <option value="1">Chapter 1</option>
                <option value="2">Chapter 2</option>
            </select>
        `;
        vi.mocked(SettingsManager.get).mockImplementation((key) => {
            switch (key) {
                case 'chapterFetchMaxRetries':
                    return 0 as never;
                case 'chapterRetryBaseMs':
                    return 0 as never;
                case 'chapterFetchTimeoutMs':
                    return 1000 as never;
                case 'chapterPass1DelayMs':
                case 'chapterCooldownMs':
                case 'chapterPass2DelayMs':
                    return 0 as never;
                default:
                    return 0 as never;
            }
        });

        fetchRequestTextMock.mockImplementation(async ({ url }) => {
            if (url.endsWith('/1/')) return okResponse(storyPageHtml('<p>One</p>'));
            return okResponse(missingStoryPageHtml());
        });
        confirmRetryDialogMock.mockResolvedValue('build');

        await _runScraper('1', 'https://www.fanfiction.net/s/1/1/', localMetaSerializer);

        expect(confirmRetryDialogMock).toHaveBeenCalledWith([1], ['Chapter 2']);
        const [, chapters] = buildMock.mock.calls[0];
        expect(chapters[1].content).toContain('Chapter 2 could not be downloaded');
    });
});
