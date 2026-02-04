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

    async downloadAsHTML(storyIdOrUrl: string, onProgress?: CallableFunction): Promise<void> {
        // We could implement a simple HTML dump here, 
        // but for now we'll alias it to EPUB or throw, 
        // as parsing to single-file HTML is complex.
        if (confirm("Native HTML download not fully supported. Download EPUB instead?")) {
            return this.downloadAsEPUB(storyIdOrUrl, onProgress);
        }
    },

    async downloadAsMOBI(_u: string, _p?: CallableFunction): Promise<void> {
        alert("Native MOBI generation is not supported. Please use EPUB.");
    },

    async downloadAsPDF(_u: string, _p?: CallableFunction): Promise<void> {
        alert("Native PDF generation is not supported. Please use EPUB.");
    },
};

async function _fetchChapter(storyId: string, chapterNum: number): Promise<string> {
    const url = `/s/${storyId}/${chapterNum}/`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Network error");
    const text = await resp.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');

    // Use Core Delegate to find the story text in the parsed document
    return Core.getElement(Elements.STORY_TEXT, doc)?.innerHTML || "<p>Error: Content missing</p>";
}

/**
 * The core scraping logic.
 */
async function _runScraper(storyId: string, onProgress?: CallableFunction): Promise<void> {
    const log = Core.getLogger('NativeDownloader', 'runScraper');

    // 1. Metadata Scraping (Header) via Core Delegate
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
            chapters.push({
                title: chapterList[i].name,
                number: num, // Propagated change: Adding the chapter number
                content
            });

            // RANDOM DELAY: 1.5s to 3s to avoid rate limits
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