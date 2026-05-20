// modules/NativeDownloader.ts

import { Core } from './Core';
import { IFanficDownloader } from '../interfaces/IFanficDownloader';
import { EpubBuilder } from './EpubBuilder';
import { ChapterData } from '../interfaces/ChapterData';
import { Elements } from '../enums/Elements';
import { LocalMetadataSerializer } from '../serializers/LocalMetadataSerializer';
import { fetchRequestText, type FetchTextResponse } from '../utils/fetchRequest';

const MODULE_NAME = 'NativeDownloader';
const CHAPTER_FETCH_MAX_RETRIES = 5;
const CHAPTER_FETCH_TIMEOUT_MS = 30_000;
const CHAPTER_RETRY_BASE_MS = 5_000;

/**
 * Fallback strategy that scrapes the content directly from the browser.
 * Useful when FicHub is down or stale.
 */
export const NativeDownloader: IFanficDownloader = {
    MODULE_NAME: MODULE_NAME,

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
 * Uses GM_xmlhttpRequest because FFN sometimes rejects browser fetch() chapter
 * requests with 403 while page-like extension requests still succeed.
 */
export async function _fetchChapter(
    storyId: string,
    chapterRef: string | number,
    chapterNum: number,
    onProgress?: CallableFunction
): Promise<string> {
    const url = _resolveChapterUrl(storyId, chapterRef);
    const log = Core.getLogger(MODULE_NAME, 'fetchChapter');

    for (let attempt = 1; attempt <= CHAPTER_FETCH_MAX_RETRIES + 1; attempt++) {
        const response = await fetchRequestText({
            method: 'GET',
            url,
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: CHAPTER_FETCH_TIMEOUT_MS,
        });

        if (response.ok) {
            const doc = new DOMParser().parseFromString(response.responseText, 'text/html');
            const contentEl = Core.getElement(Elements.STORY_TEXT, doc);
            if (contentEl) return contentEl.innerHTML;

            throw new Error(`Chapter ${chapterNum} loaded, but the story text container was missing.`);
        }

        if (_isRetryableChapterResponse(response) && attempt <= CHAPTER_FETCH_MAX_RETRIES) {
            const delay = CHAPTER_RETRY_BASE_MS * Math.pow(2, attempt - 1);
            const msg = _chapterRetryMessage(chapterNum, response, delay);
            log(msg);
            if (onProgress) onProgress(msg);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }

        throw new Error(_chapterFailureMessage(chapterNum, response));
    }

    throw new Error(`Download aborted while fetching chapter ${chapterNum}.`);
}

export function _resolveChapterUrl(storyId: string, chapterRef: string | number): string {
    const ref = String(chapterRef || '').trim();
    if (/^https?:\/\//i.test(ref)) return ref;
    if (ref.startsWith('/')) return new URL(ref, window.location.origin).href;
    return new URL(`/s/${storyId}/${ref || '1'}/`, window.location.origin).href;
}

function _isRetryableChapterResponse(response: FetchTextResponse): boolean {
    return response.status === 0 || response.status === 403 || response.status === 429 || response.status >= 500;
}

function _chapterRetryMessage(chapterNum: number, response: FetchTextResponse, delay: number): string {
    if (response.status === 403) {
        return `Chapter ${chapterNum} returned 403. Cooling down for ${delay / 1000}s...`;
    }
    if (response.status === 429) {
        return `Rate limit hit on chapter ${chapterNum}. Cooling down for ${delay / 1000}s...`;
    }
    const reason = response.reason || `HTTP ${response.status}`;
    return `Chapter ${chapterNum} request failed (${reason}). Retrying in ${delay / 1000}s...`;
}

function _chapterFailureMessage(chapterNum: number, response: FetchTextResponse): string {
    if (response.isCfChallenge) {
        return `Download aborted while fetching chapter ${chapterNum}: FFN returned a browser challenge. Open the chapter normally once, then retry.`;
    }
    const reason = response.reason || `HTTP ${response.status}`;
    return `Download aborted while fetching chapter ${chapterNum}: ${reason}.`;
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
    const log = Core.getLogger(MODULE_NAME, 'runScraper');
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
            const chapterRef = chapterList[i]?.id || String(num);
            const content = await _fetchChapter(storyId, chapterRef, num, onProgress);
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
            const reason = e instanceof Error ? e.message : String(e);
            throw new Error(`Failed to fetch chapter ${num}: ${reason}`);
        }
    }

    // 4. Build
    if (onProgress) onProgress("Bundling EPUB...");
    await EpubBuilder.build(finalMeta, chapters);
}
