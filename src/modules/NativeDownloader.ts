// modules/NativeDownloader.ts

import { Core } from './Core';
import { IFanficDownloader } from '../interfaces/IFanficDownloader';
import { EpubBuilder } from './EpubBuilder';
import { ChapterData } from '../interfaces/ChapterData';
import { Elements } from '../enums/Elements';
import { LocalMetadataSerializer } from '../serializers/LocalMetadataSerializer';
import { fetchRequestText, type FetchTextResponse } from '../utils/fetchRequest';
import { SettingsManager } from './SettingsManager';
import { confirmRetryDialog } from '../utils/confirmDialog';

const MODULE_NAME = 'NativeDownloader';

type ChapterFailureCode = 'content-validation' | 'request-failure';

export class ChapterFetchError extends Error {
    public readonly code: ChapterFailureCode;
    public readonly chapterNum: number;

    constructor(chapterNum: number, code: ChapterFailureCode, message: string) {
        super(message);
        this.name = 'ChapterFetchError';
        this.code = code;
        this.chapterNum = chapterNum;
    }
}

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
 * Uses the service-worker fetch proxy because FFN sometimes rejects plain
 * page fetch() chapter requests with 403 while extension requests still succeed.
 */
export async function _fetchChapter(
    storyId: string,
    chapterRef: string | number,
    chapterNum: number,
    onProgress?: CallableFunction
): Promise<string> {
    const url = _resolveChapterUrl(storyId, chapterRef);
    const log = Core.getLogger(MODULE_NAME, 'fetchChapter');
    const maxRetries = SettingsManager.get('chapterFetchMaxRetries');
    const timeoutMs = SettingsManager.get('chapterFetchTimeoutMs');
    const retryBaseMs = SettingsManager.get('chapterRetryBaseMs');

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        const response = await fetchRequestText({
            method: 'GET',
            url,
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: timeoutMs,
        });

        if (response.ok) {
            const doc = new DOMParser().parseFromString(response.responseText, 'text/html');
            const contentEl = Core.getElement(Elements.STORY_TEXT, doc);
            if (contentEl) return contentEl.innerHTML;

            if (attempt <= maxRetries) {
                const delay = _chapterRetryDelay(retryBaseMs, attempt);
                const msg = `Chapter ${chapterNum} loaded but story container was missing. Retrying in ${delay / 1000}s...`;
                log(msg);
                if (onProgress) onProgress(msg);
                await _sleep(delay);
                continue;
            }

            throw new ChapterFetchError(
                chapterNum,
                'content-validation',
                `Download aborted while fetching chapter ${chapterNum}: story container missing after ${maxRetries + 1} attempts.`
            );
        }

        if (_isRetryableChapterResponse(response) && attempt <= maxRetries) {
            const delay = _chapterRetryDelay(retryBaseMs, attempt);
            const msg = _chapterRetryMessage(chapterNum, response, delay);
            log(msg);
            if (onProgress) onProgress(msg);
            await _sleep(delay);
            continue;
        }

        throw new ChapterFetchError(chapterNum, 'request-failure', _chapterFailureMessage(chapterNum, response));
    }

    throw new ChapterFetchError(chapterNum, 'request-failure', `Download aborted while fetching chapter ${chapterNum}.`);
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
export async function _runScraper(
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

    const chapters: (ChapterData | null)[] = new Array(total).fill(null);
    log(`Starting scrape for ${total} chapters.`);
    const pass1DelayMs = SettingsManager.get('chapterPass1DelayMs');
    const cooldownMs = SettingsManager.get('chapterCooldownMs');
    const pass2DelayMs = SettingsManager.get('chapterPass2DelayMs');

    // 3. Pass 1
    let failedIndices = await _runChapterPass({
        storyId,
        chapterList,
        chapters,
        indices: Array.from({ length: total }, (_, index) => index),
        passLabel: 'Pass 1',
        delayMs: pass1DelayMs,
        totalChapters: total,
        onProgress,
    });

    // 4. Pass 2 and user-directed follow-up retries
    if (failedIndices.length > 0) {
        const cooldownMessage = `Pass 1 complete. ${failedIndices.length} chapters failed. Cooling down...`;
        log(cooldownMessage);
        if (onProgress) onProgress(cooldownMessage);
        await _sleep(cooldownMs);
    }

    while (failedIndices.length > 0) {
        failedIndices = await _runChapterPass({
            storyId,
            chapterList,
            chapters,
            indices: failedIndices,
            passLabel: 'Pass 2',
            delayMs: pass2DelayMs,
            totalChapters: total,
            onProgress,
        });

        if (failedIndices.length === 0) break;

        const chapterNames = failedIndices.map(index => _chapterTitle(chapterList, index, finalMeta.title));
        const choice = await confirmRetryDialog(failedIndices, chapterNames);

        if (choice === 'retry') {
            const retryMessage = `Retrying ${failedIndices.length} failed chapters again...`;
            log(retryMessage);
            if (onProgress) onProgress(retryMessage);
            continue;
        }

        if (choice === 'build') {
            _fillMissingChapters(chapters, failedIndices, chapterList, finalMeta.title);
            break;
        }

        throw new Error('Download cancelled by user after retry exhaustion.');
    }

    // 5. Build
    if (onProgress) onProgress("Bundling EPUB...");
    await EpubBuilder.build(finalMeta, chapters.filter((chapter): chapter is ChapterData => chapter !== null));
}

interface ChapterOption {
    id: string;
    name: string;
}

interface ChapterPassOptions {
    storyId: string;
    chapterList: ChapterOption[];
    chapters: (ChapterData | null)[];
    indices: number[];
    passLabel: string;
    delayMs: number;
    totalChapters: number;
    onProgress?: CallableFunction;
}

async function _runChapterPass(options: ChapterPassOptions): Promise<number[]> {
    const log = Core.getLogger(MODULE_NAME, 'runChapterPass');
    const failedIndices: number[] = [];

    for (let position = 0; position < options.indices.length; position++) {
        const index = options.indices[position];
        const chapterNum = index + 1;
        const chapterRef = options.chapterList[index]?.id || String(chapterNum);
        const progressLabel = options.passLabel === 'Pass 1'
            ? `Fetching ${chapterNum}/${options.totalChapters}...`
            : `Retrying ${position + 1}/${options.indices.length} (chapter ${chapterNum}/${options.totalChapters})...`;

        if (options.onProgress) options.onProgress(progressLabel);

        try {
            const content = await _fetchChapter(options.storyId, chapterRef, chapterNum, options.onProgress);
            options.chapters[index] = {
                title: _chapterTitle(options.chapterList, index),
                number: chapterNum,
                content,
            };
            log(`${options.passLabel} fetched chapter ${chapterNum}.`);
        } catch (e) {
            failedIndices.push(index);
            log(`${options.passLabel} failed for chapter ${chapterNum}`, e);
            if (options.onProgress) {
                options.onProgress(`${options.passLabel} failed for chapter ${chapterNum}. ${_chapterErrorMessage(e)}`);
            }
        }

        if (position < options.indices.length - 1) {
            await _sleep(options.delayMs);
        }
    }

    return failedIndices;
}

function _chapterRetryDelay(baseMs: number, attempt: number): number {
    return baseMs * Math.pow(2, attempt - 1);
}

function _sleep(delayMs: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, delayMs));
}

function _chapterTitle(chapterList: ChapterOption[], index: number, fallbackTitle?: string): string {
    return chapterList[index]?.name || fallbackTitle || `Chapter ${index + 1}`;
}

function _chapterErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function _fillMissingChapters(
    chapters: (ChapterData | null)[],
    failedIndices: number[],
    chapterList: ChapterOption[],
    fallbackTitle: string
): void {
    for (const index of failedIndices) {
        const chapterNum = index + 1;
        chapters[index] = {
            title: _chapterTitle(chapterList, index, fallbackTitle),
            number: chapterNum,
            content: `<p><em>Chapter ${chapterNum} could not be downloaded. Please retry the download.</em></p>`,
        };
    }
}
