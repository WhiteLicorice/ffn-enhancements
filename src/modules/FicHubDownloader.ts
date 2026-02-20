// modules/FicHubDownloader.ts

import { Core } from './Core';
import { GM_xmlhttpRequest } from '$';
import { IFanficDownloader } from '../interfaces/IFanficDownloader';
import { SupportedFormats } from '../enums/SupportedFormats';
import { FicHubStatus } from '../enums/FicHubStatus';
import { LocalMetadataSerializer } from '../serializers/LocalMetadataSerializer';
import { FicHubMetadataSerializer } from '../serializers/FicHubMetadataSerializer';
import { Globals } from '../enums/Globals';
import JSZip from 'jszip';

/**
 * Concrete implementation of the Downloader strategy using the FicHub API.
 * Handles the external API communication, error parsing, and final file retrieval.
 */
export const FicHubDownloader: IFanficDownloader = {

    /**
     * Downloads the story as an EPUB (E-book) file.
     * INJECTS LOCAL COVER ART into the FicHub EPUB before saving.
     */
    downloadAsEPUB: async function (storyUrl: string, onProgress?: CallableFunction): Promise<void> {
        const log = Core.getLogger('FicHubDownloader', 'downloadAsEPUB');

        try {
            // 1. Get the download URL from FicHub API
            const dlUrl = await _getFicHubDownloadUrl(storyUrl, SupportedFormats.EPUB, onProgress);

            if (onProgress) onProgress("Fetching EPUB Data...");

            // 2. Download the EPUB blob directly
            const epubBlob = await _fetchBlob(dlUrl);

            // 3. Serialize Local Metadata to get the Cover Blob
            if (onProgress) onProgress("Scraping Local Cover...");

            // Extract ID from URL for the serializer (Basic regex for FFN)
            const storyId = storyUrl.match(/\/s\/(\d+)/)?.[1] || "0";
            const serializer = new LocalMetadataSerializer(storyId, storyUrl);
            const metadata = await serializer.serialize();

            let finalBlob = epubBlob;
            const filename = `${metadata.title} - ${metadata.author}.epub`;

            // 4. Inject Cover if available
            if (metadata.coverBlob) {
                if (onProgress) onProgress("Injecting Cover...");
                try {
                    finalBlob = await _injectCoverIntoEpub(epubBlob, metadata.coverBlob);
                    log("Cover injected successfully.");
                } catch (e) {
                    log("Failed to inject cover. Saving original.", e);
                }
            } else {
                log("No local cover found. Saving original.");
            }

            // 5. Save the file
            if (onProgress) onProgress("Saving...");
            _saveBlob(finalBlob, _sanitizeFilename(filename));

        } catch (e) {
            log("EPUB Download Failed", e);
            alert("Download failed. Check console for details.");
        }
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
 * @param storyUrl The canonical URL of the story.
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
 * Standard processing for formats that do not require post-processing (HTML, PDF, MOBI).
 * Simply redirects the browser to the file.
 */
function _processApiRequest(storyUrl: string, format: SupportedFormats, onProgress?: CallableFunction): Promise<void> {
    const log = Core.getLogger('FicHubDownloader', 'processApiRequest');

    return _getFicHubDownloadUrl(storyUrl, format, onProgress)
        .then(dlUrl => {
            log(`Redirecting to: ${dlUrl}`);
            if (onProgress) onProgress("Downloading...");
            window.location.href = dlUrl;
        })
        .catch(err => {
            log('Download flow failed', err);
            throw err;
        });
}

/**
 * Contacts the FicHub API to generate the file and retrieve the download URL.
 */
function _getFicHubDownloadUrl(storyUrl: string, format: SupportedFormats, onProgress?: CallableFunction): Promise<string> {
    const log = Core.getLogger('FicHubDownloader', 'getDownloadUrl');
    const apiUrl = `https://fichub.net/api/v0/epub?q=${encodeURIComponent(storyUrl)}`;

    log(`Initiating API request for ${format}: ${apiUrl}`);
    if (onProgress) onProgress("Requesting...");

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "GET",
            url: apiUrl,
            headers: { "User-Agent": Globals.USER_AGENT },
            onload: (res: { status: number; responseText: string }) => {
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
                        resolve("https://fichub.net" + rel);
                    } else {
                        log(`Format '${format}' not found in API response.`, data);
                        alert(`FicHub could not generate a ${format} file for this story.`);
                        reject(new Error("Format not found"));
                    }
                } catch (e) {
                    reject(e);
                }
            },
            onerror: (err) => reject(err)
        });
    });
}

/**
 * Fetches the actual file content as a Blob.
 */
function _fetchBlob(url: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            responseType: "blob",
            onload: (res) => {
                if (res.status === 200) resolve(res.response);
                else reject(new Error(`Download failed: ${res.status}`));
            },
            onerror: reject
        });
    });
}

/**
 * Injects the cover image into the EPUB structure using JSZip.
 * Supports "Naked" EPUBs (FicHub default) by creating the necessary XML structure.
 * Only injects the thumbnail; does not create a cover page.
 */
async function _injectCoverIntoEpub(epubBlob: Blob, coverBlob: Blob): Promise<Blob> {
    const log = Core.getLogger('FicHubDownloader', 'injectCover');
    const zip = await JSZip.loadAsync(epubBlob);

    // 1. Find the OPF file location from container.xml
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) throw new Error("Invalid EPUB: Missing container.xml");

    const container = await containerFile.async("text");
    const opfPathMatch = container.match(/full-path="([^"]+)"/);
    if (!opfPathMatch) throw new Error("Invalid EPUB: Cannot find OPF path");

    const opfPath = opfPathMatch[1];
    const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));

    // 2. Parse OPF
    const opfFile = zip.file(opfPath);
    if (!opfFile) throw new Error(`Invalid EPUB: Missing OPF file at ${opfPath}`);

    const opfContent = await opfFile.async("text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(opfContent, "application/xml");

    const opfNamespace = "http://www.idpf.org/2007/opf";

    // 3. Determine if a cover already exists
    let coverMeta = doc.querySelector('meta[name="cover"]');

    if (coverMeta) {
        // --- SCENARIO A: Cover Exists (Replace it) ---
        log("Existing cover metadata found. Replacing file.");
        const coverId = coverMeta.getAttribute("content");
        if (coverId) {
            const item = doc.getElementById(coverId) || doc.querySelector(`item[id="${coverId}"]`);
            if (item) {
                const href = item.getAttribute("href");
                if (href) {
                    const fullPath = opfDir ? `${opfDir}/${href}` : href;
                    zip.file(fullPath, coverBlob);
                    // Return early, job done (metadata is already correct)
                    return await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
                }
            }
        }
    }

    // --- SCENARIO B: No Cover (Create Metadata & Inject Image) ---
    log("No existing cover found. Injecting image and metadata.");

    // Constants for new items
    const COVER_IMAGE_ID = "cover-image";
    const COVER_IMG_FILENAME = "images/cover.jpg";

    // A. Add the Image File to Zip
    // If opf is in "EPUB/", file goes to "EPUB/images/cover.jpg"
    const fullImgPath = opfDir ? `${opfDir}/${COVER_IMG_FILENAME}` : COVER_IMG_FILENAME;
    zip.file(fullImgPath, coverBlob);

    // B. Modify OPF: Metadata
    const metadata = doc.getElementsByTagNameNS(opfNamespace, "metadata")[0];
    if (metadata) {
        const metaEl = doc.createElementNS(opfNamespace, "meta");
        metaEl.setAttribute("name", "cover");
        metaEl.setAttribute("content", COVER_IMAGE_ID);
        metadata.appendChild(metaEl);
    }

    // C. Modify OPF: Manifest
    const manifest = doc.getElementsByTagNameNS(opfNamespace, "manifest")[0];
    if (manifest) {
        // Item: Image
        const itemImg = doc.createElementNS(opfNamespace, "item");
        itemImg.setAttribute("id", COVER_IMAGE_ID);
        itemImg.setAttribute("href", COVER_IMG_FILENAME);
        itemImg.setAttribute("media-type", "image/jpeg");
        // Add "cover-image" property for EPUB 3 compliance
        itemImg.setAttribute("properties", "cover-image");
        manifest.appendChild(itemImg);
    }

    // Note: We deliberately do not add a cover page to the spine or guide,
    // to preserve the original reading order of the FicHub file.

    // 4. Save modified OPF back to zip
    const serializer = new XMLSerializer();
    const newOpfContent = serializer.serializeToString(doc);
    zip.file(opfPath, newOpfContent);

    return await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
}

/**
 * Triggers a browser download for the Blob.
 */
function _saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

function _sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, "").trim();
}