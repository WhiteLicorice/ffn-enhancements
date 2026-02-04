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
 * IMPLEMENTS: Exponential Backoff for HTTP 429 (Rate Limiting).
 */
async function _fetchChapter(storyId: string, chapterNum: number, onProgress?: CallableFunction): Promise<string> {
    const url = `/s/${storyId}/${chapterNum}/`;
    const log = Core.getLogger('NativeDownloader', 'fetchChapter');

    let attempt = 0;
    const maxRetries = 5;
    let backoffDelay = 5000; // Start with 5 seconds

    while (attempt <= maxRetries) {
        const resp = await fetch(url);

        // Success case
        if (resp.ok) {
            const text = await resp.text();
            const doc = new DOMParser().parseFromString(text, 'text/html');

            // Use the Delegate with the 'doc' override to find elements in the parsed HTML
            const contentEl = Core.getElement(Elements.STORY_TEXT, doc);
            return contentEl?.innerHTML || "<p>Error: Content missing</p>";
        }

        // Rate Limit case (429)
        if (resp.status === 429) {
            attempt++;
            if (attempt > maxRetries) {
                log(`Max retries (${maxRetries}) exceeded for chapter ${chapterNum}.`);
                throw new Error("Download aborted: Too many rate limit errors.");
            }

            const waitSeconds = backoffDelay / 1000;
            const msg = `Rate limit hit (429). Cooling down for ${waitSeconds}s...`;
            log(msg);

            // Update UI so user knows why it's stuck
            if (onProgress) onProgress(msg);

            // Wait and then double the delay for next time
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            backoffDelay *= 2;
        } else {
            // Hard error (404, 500, etc)
            throw new Error(`Network error: ${resp.status}`);
        }
    }

    throw new Error("Unknown error in fetch loop.");
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
        // Try resolutions in order of preference: 180 (Mobile High Res) -> 150 (Desktop) -> Original
        const baseUrl = coverImg.src;
        const resolutions = ['/180/', '/150/'];

        for (const res of resolutions) {
            try {
                // If the current src contains /75/ or /150/, try to upgrade it
                const targetUrl = baseUrl.replace(/\/75\/|\/150\/|\/180\//, res);
                log(`Probing cover resolution: ${res}`);

                const imgResp = await fetch(targetUrl);
                if (imgResp.ok) {
                    coverBlob = await imgResp.blob();
                    log(`Successfully fetched ${res} resolution.`);
                    break; // Exit loop on success
                }
            } catch (e) {
                log(`Failed to fetch resolution ${res}, trying next...`);
            }
        }

        // Final fallback to the exact src found on page if probes failed
        if (!coverBlob) {
            try {
                const finalResp = await fetch(baseUrl);
                if (finalResp.ok) coverBlob = await finalResp.blob();
            } catch (e) {
                log('Final cover fallback failed.', e);
            }
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

        // Notify UI (only if not currently cooling down)
        if (onProgress) onProgress(`Fetching ${num}/${total}...`);

        try {
            // Pass onProgress down so _fetchChapter can update UI during backoff
            const content = await _fetchChapter(storyId, num, onProgress);
            log(`Fetched Chapter ${num}.`);
            chapters.push({
                title: chapterList[i].name,
                number: num,
                content
            });

            // RANDOM DELAY: 1.5s to 3s to avoid rate limits (Polite Crawler)
            // This runs on successful fetches to prevent hitting the limit in the first place
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