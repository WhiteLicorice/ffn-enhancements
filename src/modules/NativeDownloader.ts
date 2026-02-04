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
        // Extract Story ID
        const storyId = storyIdOrUrl.match(/s\/(\d+)/)?.[1] || storyIdOrUrl;

        // Construct Canonical URL (Force Chapter 1)
        // If the input was a URL, we try to preserve the slug but force /1/
        // If it was just an ID, we construct a standard URL.
        let storyUrl = `https://www.fanfiction.net/s/${storyId}/1/`;

        if (storyIdOrUrl.includes('fanfiction.net')) {
            // Regex: matches /s/ID/CHAPTER/ and replaces CHAPTER with 1
            // This preserves the slug at the end if it exists.
            storyUrl = storyIdOrUrl.replace(/\/s\/(\d+)\/\d+/, '/s/$1/1');
        }

        await _runScraper(storyId, storyUrl, onProgress);
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
async function _runScraper(storyId: string, storyUrl: string, onProgress?: CallableFunction): Promise<void> {
    const log = Core.getLogger('NativeDownloader', 'runScraper');

    // 1. Metadata Scraping (Header)
    const title = Core.getElement(Elements.STORY_TITLE)?.textContent || 'Unknown Title';

    // Capture the anchor element to get both text and href
    const authorEl = Core.getElement(Elements.STORY_AUTHOR) as HTMLAnchorElement;
    const author = authorEl?.textContent || 'Unknown Author';
    const authorUrl = authorEl?.href;

    const summary = Core.getElement(Elements.STORY_SUMMARY)?.textContent || '';

    log(`Fetched partial metadata ${title}, ${author}, ${summary}.`);

    // 1b. Cover Art Scraping
    let coverBlob: Blob | undefined;
    const coverImg = Core.getElement(Elements.STORY_COVER) as HTMLImageElement;
    if (coverImg && coverImg.src) {
        // Attempt to upgrade resolution from thumb (75px) to medium (180px)
        let highResSrc = coverImg.src;
        if (highResSrc.includes('/75/')) {
            highResSrc = highResSrc.replace('/75/', '/180/');
            log(`Upgrading cover image resolution: ${highResSrc}`);
        } else {
            log(`Found cover image: ${highResSrc}`);
        }

        try {
            const imgResp = await fetch(highResSrc);
            if (imgResp.ok) {
                coverBlob = await imgResp.blob();
                log('Cover image fetched successfully.');
            } else {
                // Fallback to original src if upgrade fails
                log('High-res fetch failed, falling back to original.');
                const originalResp = await fetch(coverImg.src);
                if (originalResp.ok) {
                    coverBlob = await originalResp.blob();
                }
            }
        } catch (e) {
            log('Failed to fetch cover image.', e);
        }
    }

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
        authorUrl,
        description: summary,
        source: 'FanFiction.net',
        storyUrl: storyUrl,
        coverBlob: coverBlob
    }, chapters);
}