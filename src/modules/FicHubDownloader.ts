// modules/FicHubDownloader.ts

import { Core } from './Core';
import { GM_xmlhttpRequest } from '$';
import { IFanficDownloader } from '../interfaces/IFanficDownloader';
import { SupportedFormats } from '../enums/SupportedFormats';
import { FicHubStatus } from '../enums/FicHubStatus';
import { LocalMetadataSerializer } from '../serializers/LocalMetadataSerializer';
import { FicHubMetadataSerializer } from '../serializers/FicHubMetadataSerializer';
import { Globals } from '../enums/Globals';

/**
 * Concrete implementation of the Downloader strategy using the FicHub API.
 * Handles the external API communication, error parsing, and final file retrieval.
 */
export const FicHubDownloader: IFanficDownloader = {

    /**
     * Downloads the story as an EPUB (E-book) file.
     */
    downloadAsEPUB: function (storyUrl: string, onProgress?: CallableFunction): Promise<void> {
        return _processApiRequest(storyUrl, SupportedFormats.EPUB, onProgress);
    },

    /**
     * Downloads the story as a MOBI (Kindle) file.
     */
    downloadAsMOBI: function (storyUrl: string, onProgress?: CallableFunction): Promise<void> {
        return _processApiRequest(storyUrl, SupportedFormats.MOBI, onProgress);
    },

    /**
     * Downloads the story as a PDF document.
     */
    downloadAsPDF: function (storyUrl: string, onProgress?: CallableFunction): Promise<void> {
        return _processApiRequest(storyUrl, SupportedFormats.PDF, onProgress);
    },

    /**
     * Downloads the story as a single HTML file.
     */
    downloadAsHTML: function (storyUrl: string, onProgress?: CallableFunction): Promise<void> {
        return _processApiRequest(storyUrl, SupportedFormats.HTML, onProgress);
    },
};

/**
 * Compares Local metadata against FicHub metadata to determine freshness.
 * USES GM_xmlhttpRequest TO BYPASS CORS.
 * * @param storyUrl The canonical URL of the story.
 * @param localMeta The serializer containing local page statistics.
 * @returns - FicHubStatus (whether the API returns STALE, FRESH, or ERROR)
 */
export function checkFicHubFreshness(
    storyUrl: string,
    localMeta: LocalMetadataSerializer
): Promise<FicHubStatus> {
    const log = Core.getLogger('FicHubDownloader', 'checkFreshness');

    return new Promise((resolve) => {
        const apiUrl = `https://fichub.net/api/v0/meta?q=${encodeURIComponent(storyUrl)}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: apiUrl,
            headers: { "User-Agent": Globals.USER_AGENT },
            onload: (res) => {
                if (res.status !== 200) {
                    log(`API Error: ${res.status}`);
                    resolve(FicHubStatus.ERROR);
                    return;
                }

                try {
                    const jsonData = JSON.parse(res.responseText);
                    const ficHubMeta = new FicHubMetadataSerializer(jsonData);

                    if (!ficHubMeta.getUpdatedDate() || !ficHubMeta.getChapterCount()) {
                        resolve(FicHubStatus.ERROR);
                        return;
                    }

                    const localCount = localMeta.getChapterCount();
                    const ficHubCount = ficHubMeta.getChapterCount();

                    const localDate = localMeta.getUpdatedDate();
                    const ficHubDate = ficHubMeta.getUpdatedDate();

                    log(`Local: ${localCount} ch / ${localDate.toISOString()} | FicHub: ${ficHubCount} ch / ${ficHubDate.toISOString()}`);

                    /**
                     * FRESHNESS LOGIC REVISION:
                     * The Local Page is the Source of Truth.
                     */

                    // 1. Chapter Count is the most reliable indicator.
                    // If FicHub has different chapters than the page we are on, it is definitely stale.
                    if (ficHubCount != localCount) {
                        log(`FicHub Stale: Missing chapters (Hub: ${ficHubCount} vs Page: ${localCount})`);
                        resolve(FicHubStatus.STALE);
                        return;
                    }

                    // 2. Date Check (Typos/Content updates without chapter changes)
                    // We use a 24-hour margin (86,400,000 ms) because site timestamps vs Hub scrapers
                    // are rarely in sync and often suffer from 8-12 hour timezone offsets.
                    // Only report stale if the Page is more than a full day newer than the Hub cache.
                    const ONE_DAY = 86400000;
                    if (localDate.getTime() > (ficHubDate.getTime() + ONE_DAY)) {
                        log(`FicHub Stale: Content on page is significantly newer (>24h) than Hub cache.`);
                        resolve(FicHubStatus.STALE);
                        return;
                    }

                    resolve(FicHubStatus.FRESH);

                } catch (e) {
                    log("Freshness check failed during parsing.", e);
                    resolve(FicHubStatus.ERROR);
                }
            },
            onerror: (err) => {
                log("Freshness check network error.", err);
                resolve(FicHubStatus.ERROR);
            }
        });
    });
}

/**
 * Internal helper to handle the shared logic of calling the FicHub API.
 * @param storyUrl - The full URL of the story.
 * @param format - The internal format string used by the API (epub, mobi, pdf, html).
 * @param onProgress - Optional callback to report initial status.
 */
function _processApiRequest(storyUrl: string, format: SupportedFormats, onProgress?: CallableFunction): Promise<void> {
    const log = Core.getLogger('FicHubDownloader', 'processApiRequest');
    const apiUrl = `https://fichub.net/api/v0/epub?q=${encodeURIComponent(storyUrl)}`;

    log(`Initiating download for ${format}. API: ${apiUrl}`);

    if (onProgress) {
        onProgress("Requesting...");
    }

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "GET",
            url: apiUrl,
            headers: { "User-Agent": Globals.USER_AGENT },
            onload: (res: { status: number; responseText: string }) => {
                log(`Response received. Status: ${res.status}`);

                if (res.status === 429) {
                    log("Fichub Server Busy (429).");
                    alert("Fichub Server Busy. Please try again later.");
                    reject(new Error("429: Server Busy"));
                    return;
                }

                try {
                    const data = JSON.parse(res.responseText);
                    const rel = data.urls?.[format] || data[format + '_url'];

                    if (rel) {
                        const dlUrl = "https://fichub.net" + rel;
                        log(`Download URL found: ${dlUrl}`);

                        if (onProgress) onProgress("Downloading...");

                        window.location.href = dlUrl;
                        resolve();
                    } else {
                        log(`Format '${format}' not found in API response.`, data);
                        alert(`FicHub could not generate a ${format} file for this story.`);
                        reject(new Error("Format not found"));
                    }
                } catch (e) {
                    log('JSON Parsing Error', e);
                    reject(e);
                }
            },
            onerror: (err) => {
                log('Network/GM_xmlhttpRequest Error', err);
                reject(err);
            }
        });
    });
}