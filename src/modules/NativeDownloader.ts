// modules/NativeDownloader.ts

import { Core } from './Core';
import { IFanficDownloader } from '../interfaces/IFanficDownloader';
import { EpubBuilder } from './EpubBuilder';
import { ChapterData } from '../interfaces/ChapterData';
import { Elements } from '../enums/Elements';
import { LocalMetadataSerializer } from '../serializers/LocalMetadataSerializer';

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

        // Initialize Local Serializer
        // We still need this here because the scraper uses it to build the EPUB metadata
        const localMeta = new LocalMetadataSerializer(storyId, storyUrl);

        // --- NO STALENESS CHECK HERE ---
        // The decision to use Native vs FicHub is now handled by the StoryDownloader (UI layer).
        // If we are here, the user has already confirmed they want to scrape.

        await _runScraper(storyId, storyUrl, localMeta, onProgress);
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
    let backoffDelay = 5000;

    while (attempt <= maxRetries) {
        const resp = await fetch(url);
        if (resp.ok) {
            const text = await resp.text();
            const doc = new DOMParser().parseFromString(text, 'text/html');
            const contentEl = Core.getElement(Elements.STORY_TEXT, doc);
            return contentEl?.innerHTML || "<p>Error: Content missing</p>";
        }

        if (resp.status === 429) {
            attempt++;
            if (attempt > maxRetries) {
                log(`Max retries (${maxRetries}) exceeded.`);
                throw new Error("Download aborted: Too many rate limit errors.");
            }
            const waitSeconds = backoffDelay / 1000;
            const msg = `Rate limit hit (429). Cooling down for ${waitSeconds}s...`;
            log(msg);
            if (onProgress) onProgress(msg);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            backoffDelay *= 2;
        } else {
            throw new Error(`Network error: ${resp.status}`);
        }
    }
    throw new Error("Unknown error in fetch loop.");
}

/**
 * The core scraping logic.
 */
async function _runScraper(
    storyId: string,
    storyUrl: string,
    localMetaSerializer: LocalMetadataSerializer,
    onProgress?: CallableFunction
): Promise<void> {
    const log = Core.getLogger('NativeDownloader', 'runScraper');
    log(`Fetching from ${storyUrl}`);

    // 1. Metadata Scraping (Delegated to Serializer)
    const finalMeta = await localMetaSerializer.serialize();
    log(`Fetched metadata for "${finalMeta.title}".`);

    // 2. Determine Chapter Count
    // Use the count from metadata or fallback to 1
    const total = localMetaSerializer.getChapterCount();

    // We need the chapter names for the TOC. 
    // Since we are scraping, we can get them from the dropdown now.
    const chapSelect = Core.getElement(Elements.CHAPTER_DROPDOWN) as HTMLSelectElement;
    let chapterList: { id: string, name: string }[] = [];
    if (chapSelect) {
        chapterList = Array.from(chapSelect.options).map(opt => ({ id: opt.value, name: opt.text }));
    } else {
        chapterList = [{ id: '1', name: finalMeta.title }];
    }

    const chapters: ChapterData[] = [];
    log(`Starting scrape for ${total} chapters.`);

    // 3. Fetch Loop
    for (let i = 0; i < total; i++) {
        const num = i + 1;
        if (onProgress) onProgress(`Fetching ${num}/${total}...`);

        try {
            const content = await _fetchChapter(storyId, num, onProgress);
            log(`Fetched Chapter ${num}.`);
            chapters.push({
                title: chapterList[i]?.name || `Chapter ${num}`,
                number: num,
                content
            });

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
    await EpubBuilder.build(finalMeta, chapters);
}