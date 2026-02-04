// modules/NativeDownloader.ts

import { Core } from './Core';
import { IFanficDownloader } from '../interfaces/IFanficDownloader';
import { EpubBuilder } from './EpubBuilder';
import { ChapterData } from '../interfaces/ChapterData';
import { Elements } from '../enums/Elements';

/**
 * Fallback strategy that scrapes the content directly from the browser.
 * Useful when FicHub is down or stale.
 */
export const NativeDownloader: IFanficDownloader = {

    async downloadAsEPUB(storyIdOrUrl: string, onProgress?: CallableFunction): Promise<void> {
        // Extract Story ID if a URL is passed
        const storyId = storyIdOrUrl.match(/s\/(\d+)/)?.[1] || storyIdOrUrl;
        await _runScraper(storyId, onProgress);
    },

    async downloadAsHTML(_u: string, _onProgress?: CallableFunction): Promise<void> {
        alert("Native HTML download is not yet supported. Please use EPUB.");
    },

    async downloadAsMOBI(_u: string, _p?: CallableFunction): Promise<void> {
        alert("Native MOBI generation is not yet supported. Please use EPUB.");
    },

    async downloadAsPDF(_u: string, _p?: CallableFunction): Promise<void> {
        alert("Native PDF generation is not yet supported. Please use EPUB.");
    },
};

/**
 * Fetches and parses a single chapter.
 * Uses the Core Delegate to identify the content container within the fetched HTML.
 */
async function _fetchChapter(storyId: string, chapterNum: number): Promise<string> {
    const url = `/s/${storyId}/${chapterNum}/`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Network error");

    const text = await resp.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');

    // Use the Delegate with the 'doc' override to find elements in the parsed HTML
    const contentEl = Core.getElement(Elements.STORY_TEXT, doc);
    return contentEl?.innerHTML || "<p>Error: Content missing</p>";
}

/**
 * The core scraping logic.
 * Orchestrates the fetching of metadata and all chapters.
 */
async function _runScraper(storyId: string, onProgress?: CallableFunction): Promise<void> {
    const log = Core.getLogger('NativeDownloader', 'runScraper');

    // 1. Metadata Scraping (Header)
    // We use the Core Delegate to fetch these, ensuring selector changes are handled centrally.
    const title = Core.getElement(Elements.STORY_TITLE)?.textContent || 'Unknown Title';
    const author = Core.getElement(Elements.STORY_AUTHOR)?.textContent || 'Unknown Author';
    const summary = Core.getElement(Elements.STORY_SUMMARY)?.textContent || '';

    // 2. Determine Chapter Count
    const chapSelect = Core.getElement(Elements.CHAPTER_DROPDOWN) as HTMLSelectElement;
    let chapterList: { id: string, name: string }[] = [];

    if (chapSelect) {
        chapterList = Array.from(chapSelect.options).map(opt => ({ id: opt.value, name: opt.text }));
    } else {
        // Single chapter story
        chapterList = [{ id: '1', name: title }];
    }

    const chapters: ChapterData[] = [];
    const total = chapterList.length;

    log(`Starting scrape for ${total} chapters.`);

    // 3. Fetch Loop
    for (let i = 0; i < total; i++) {
        const num = i + 1;

        // Notify UI
        if (onProgress) onProgress(`Fetching ${num}/${total}...`);

        try {
            const content = await _fetchChapter(storyId, num);
            log(`Fetched Chapter ${num}.`);
            chapters.push({
                title: chapterList[i].name,
                number: num,
                content
            });

            // RANDOM DELAY: 1.5s to 3s to avoid rate limits (Polite Crawler)
            if (i < total - 1) {
                const delay = Math.floor(Math.random() * 1500) + 1500;
                await new Promise(r => setTimeout(r, delay));
            }
        } catch (e) {
            log(`Failed to fetch chapter ${num}`, e);
            throw new Error(`Failed to fetch chapter ${num}`);
        }
    }

    // 4. Build
    if (onProgress) onProgress("Bundling EPUB...");

    await EpubBuilder.build({
        id: storyId,
        title,
        author,
        description: summary,
        source: 'FanFiction.net'
    }, chapters);
}