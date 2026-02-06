// modules/NativeDownloader.ts

import { Core } from './Core';
import { IFanficDownloader } from '../interfaces/IFanficDownloader';
import { EpubBuilder } from './EpubBuilder';
import { ChapterData } from '../interfaces/ChapterData';
import { Elements } from '../enums/Elements';
import { StoryMetadata } from '../interfaces/StoryMetadata';
import { checkFicHubFreshness } from './FicHubDownloader';
import { FicHubStatus } from '../enums/FicHubStatus';

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

        // --- STALENESS CHECK ---
        // 1. Gather Local Stats
        const localStats = _getLocalStats();

        // 2. Compare with FicHub
        if (localStats) {
            const isStale = await checkFicHubFreshness(storyUrl, localStats.chapters, localStats.date);

            if (isStale === FicHubStatus.FRESH) {
                const proceed = confirm("FicHub has an up-to-date copy of this story. Native scraping is slower. Would you like to use the faster FicHub download instead?");
                if (proceed) {
                    alert("Please click the standard 'Download EPUB' button for the fast version.");
                    return;
                }
            } else if (isStale === FicHubStatus.STALE) {
                const proceedNative = confirm("FicHub's version is OUTDATED (Missing chapters or older date). Native scraping will get you the latest version but takes longer. Proceed with Native Scrape?");
                if (!proceedNative) return;
            }
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
 * Helper to extract the updated date and chapter count from the current DOM.
 */
function _getLocalStats(): { chapters: number, date: Date } | null {
    const metaBlock = Core.getElement(Elements.STORY_META_BLOCK);
    const chapSelect = Core.getElement(Elements.CHAPTER_DROPDOWN) as HTMLSelectElement;

    if (!metaBlock) return null;

    // Chapters
    const chapters = chapSelect ? chapSelect.options.length : 1;

    // Date
    const timeNodes = metaBlock.querySelectorAll('[data-xutime]');
    if (timeNodes.length === 0) return null;

    // The first data-xutime is usually 'Updated', or 'Published' if never updated.
    const unix = parseInt(timeNodes[0].getAttribute('data-xutime') || '0', 10);
    const date = new Date(unix * 1000);

    return { chapters, date };
}

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
 * Orchestrates the fetching of metadata and all chapters.
 */
async function _runScraper(storyId: string, storyUrl: string, onProgress?: CallableFunction): Promise<void> {
    const log = Core.getLogger('NativeDownloader', 'runScraper');

    // 1. Metadata Scraping
    const title = Core.getElement(Elements.STORY_TITLE)?.textContent || 'Unknown Title';
    const authorEl = Core.getElement(Elements.STORY_AUTHOR) as HTMLAnchorElement;
    const author = authorEl?.textContent || 'Unknown Author';
    const authorUrl = authorEl?.href;
    const summary = Core.getElement(Elements.STORY_SUMMARY)?.textContent || '';

    // 1b. Extended Metadata Parsing
    const metaBlock = Core.getElement(Elements.STORY_META_BLOCK);
    const extendedMeta = _parseFFNMetadata(metaBlock?.textContent || '');

    // 1b-2. Fix Dates using data-xutime for accuracy (Unix Timestamps)
    // FFN stores full timestamps in 'data-xutime' attributes on spans
    if (metaBlock) {
        const timeNodes = metaBlock.querySelectorAll('[data-xutime]');
        // Logic: FFN separates items with ' - '.
        // If "Updated:" was found in the text parse, the first timestamp is Updated, second is Published.
        // If "Updated:" was NOT found, the first timestamp is Published.

        if (extendedMeta.updated && timeNodes.length >= 2) {
            extendedMeta.updated = _formatUnixDate(timeNodes[0].getAttribute('data-xutime'));
            extendedMeta.published = _formatUnixDate(timeNodes[1].getAttribute('data-xutime'));
        } else if (timeNodes.length >= 1) {
            // Default to Published for the first/only date found
            extendedMeta.published = _formatUnixDate(timeNodes[0].getAttribute('data-xutime'));
        }
    }

    log(`Fetched metadata for "${title}".`);

    // 1c. Cover Art Scraping
    let coverBlob: Blob | undefined;
    const coverImg = Core.getElement(Elements.STORY_COVER) as HTMLImageElement;
    if (coverImg && coverImg.src) {
        // Try resolutions in order of preference: 180 (Mobile High Res) -> 150 (Desktop) -> Original
        const baseUrl = coverImg.src;
        const resolutions = ['/180/', '/150/'];

        for (const res of resolutions) {
            try {
                const targetUrl = baseUrl.replace(/\/75\/|\/150\/|\/180\//, res);
                log(`Probing cover resolution: ${res}`);

                const imgResp = await fetch(targetUrl);
                if (imgResp.ok) {
                    coverBlob = await imgResp.blob();
                    log(`Successfully fetched ${res} resolution.`);
                    break;
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

    const finalMeta: StoryMetadata = {
        id: storyId,
        title,
        author,
        authorUrl,
        description: summary,
        source: 'FanFiction.net',
        storyUrl: storyUrl,
        coverBlob: coverBlob,
        ...extendedMeta
    };

    await EpubBuilder.build(finalMeta, chapters);
}

/**
 * Helper to convert FFN Unix timestamp (seconds) to a full readable Date string.
 */
function _formatUnixDate(timestamp: string | null): string | undefined {
    if (!timestamp) return undefined;
    try {
        const date = new Date(parseInt(timestamp, 10) * 1000);
        // Returns "YYYY-MM-DD" format, or use .toLocaleDateString() for localized
        return date.toISOString().split('T')[0];
    } catch (e) {
        return undefined;
    }
}

/**
 * Helper to parse the hyphen-separated metadata string from FFN.
 * Example: "Rated: T - English - Parody/Romance - [Char A, Char B] - Words: 100 - ..."
 */
function _parseFFNMetadata(text: string): Partial<StoryMetadata> {
    const meta: Partial<StoryMetadata> = {
        status: 'In Progress' // Default
    };

    if (!text) return meta;

    const parts = text.split(' - ').map(s => s.trim());

    parts.forEach(part => {
        if (part.startsWith('Rated:')) {
            meta.rating = part.replace('Rated:', '').trim();
        } else if (part.startsWith('Words:')) {
            meta.words = part.replace('Words:', '').trim();
        } else if (part.startsWith('Reviews:')) {
            meta.reviews = part.replace('Reviews:', '').trim();
        } else if (part.startsWith('Favs:')) {
            meta.favs = part.replace('Favs:', '').trim();
        } else if (part.startsWith('Follows:')) {
            meta.follows = part.replace('Follows:', '').trim();
        } else if (part.startsWith('Updated:')) {
            meta.updated = part.replace('Updated:', '').trim();
        } else if (part.startsWith('Published:')) {
            meta.published = part.replace('Published:', '').trim();
        } else if (part === 'Complete') {
            meta.status = 'Complete';
        } else if (part.startsWith('[')) {
            // Characters usually enclosed in brackets e.g. [Ash K., Dawn]
            // If multiple brackets exist, FFN concatenates them.
            meta.characters = part;
        } else {
            // Heuristic for Genre and Language
            // Language is usually a single word like 'English', 'Spanish'
            // Genre is usually 'Adventure/Romance' or 'General'
            // This is inexact, but covers most cases.
            if (['English', 'Spanish', 'French', 'German', 'Chinese', 'Japanese'].includes(part)) {
                meta.language = part;
            } else if (part.includes('/') || /^[A-Z][a-z]+$/.test(part)) {
                // Likely Genre (e.g. Parody/Romance or just Drama)
                // Avoid overriding language if already set
                if (!meta.genre) meta.genre = part;
            }
        }
    });

    return meta;
}