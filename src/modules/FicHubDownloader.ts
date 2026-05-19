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

const MODULE_NAME = 'FicHubDownloader';
const FICHUB_API_TIMEOUT_MS = 60_000;
const FICHUB_FILE_TIMEOUT_MS = 120_000;
const COVER_INJECTION_TIMEOUT_MS = 120_000;
const EPUB_MIME_TYPE = 'application/epub+zip';

type FicHubTextResponse = { status: number; responseText?: string };
type FicHubBinaryResponse = { status: number; response?: unknown };

/**
 * Concrete implementation of the Downloader strategy using the FicHub API.
 * Handles the external API communication, error parsing, and final file retrieval.
 */
export const FicHubDownloader: IFanficDownloader = {
    MODULE_NAME: MODULE_NAME,

    /**
     * Downloads the story as an EPUB (E-book) file.
     * INJECTS LOCAL COVER ART into the FicHub EPUB before saving.
     */
    downloadAsEPUB: async function (storyUrl: string, onProgress?: CallableFunction): Promise<void> {
        const log = Core.getLogger(this.MODULE_NAME, 'downloadAsEPUB');

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
                    finalBlob = await _withTimeout(
                        _injectCoverIntoEpub(epubBlob, metadata.coverBlob),
                        COVER_INJECTION_TIMEOUT_MS,
                        `Cover injection timed out after ${COVER_INJECTION_TIMEOUT_MS}ms.`
                    );
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
            throw e;
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
    const log = Core.getLogger(MODULE_NAME, 'checkFreshness');

    return new Promise((resolve) => {
        const apiUrl = `https://fichub.net/api/v0/meta?q=${encodeURIComponent(storyUrl)}`;
        let settled = false;
        const resolveOnce = (status: FicHubStatus) => {
            if (settled) return;
            settled = true;
            resolve(status);
        };

        GM_xmlhttpRequest({
            method: "GET",
            url: apiUrl,
            headers: { "User-Agent": Globals.USER_AGENT },
            timeout: FICHUB_API_TIMEOUT_MS,
            onload: (res) => {
                if (res.status !== 200) {
                    log(`API Error: ${res.status}`);
                    resolveOnce(FicHubStatus.ERROR);
                    return;
                }

                try {
                    const jsonData = JSON.parse(res.responseText);
                    const ficHubMeta = new FicHubMetadataSerializer(jsonData);

                    if (!ficHubMeta.getUpdatedDate() || !ficHubMeta.getChapterCount()) {
                        resolveOnce(FicHubStatus.ERROR);
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
                        resolveOnce(FicHubStatus.STALE);
                        return;
                    }

                    // 2. Date Check (Typos/Content updates without chapter changes)
                    // We use a 24-hour margin (86,400,000 ms) because site timestamps vs Hub scrapers
                    // are rarely in sync and often suffer from 8-12 hour timezone offsets.
                    // Only report stale if the Page is more than a full day newer than the Hub cache.
                    const ONE_DAY = 86400000;
                    if (localDate.getTime() > (ficHubDate.getTime() + ONE_DAY)) {
                        log(`FicHub Stale: Content on page is significantly newer (>24h) than Hub cache.`);
                        resolveOnce(FicHubStatus.STALE);
                        return;
                    }

                    resolveOnce(FicHubStatus.FRESH);

                } catch (e) {
                    log("Freshness check failed during parsing.", e);
                    resolveOnce(FicHubStatus.ERROR);
                }
            },
            onerror: (err) => {
                log("Freshness check network error.", err);
                resolveOnce(FicHubStatus.ERROR);
            },
            ontimeout: () => {
                log("Freshness check timed out.");
                resolveOnce(FicHubStatus.ERROR);
            }
        });
    });
}

/**
 * Standard processing for formats that do not require post-processing (HTML, PDF, MOBI).
 * Simply redirects the browser to the file.
 */
function _processApiRequest(storyUrl: string, format: SupportedFormats, onProgress?: CallableFunction): Promise<void> {
    const log = Core.getLogger(MODULE_NAME, 'processApiRequest');

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
    const log = Core.getLogger(MODULE_NAME, 'getDownloadUrl');
    const apiUrl = `https://fichub.net/api/v0/epub?q=${encodeURIComponent(storyUrl)}`;

    log(`Initiating API request for ${format}: ${apiUrl}`);
    if (onProgress) onProgress("Requesting...");

    return new Promise((resolve, reject) => {
        let settled = false;
        const resolveOnce = (url: string) => { if (settled) return; settled = true; resolve(url); };
        const rejectOnce = (err: unknown) => { if (settled) return; settled = true; reject(err); };

        GM_xmlhttpRequest({
            method: "GET",
            url: apiUrl,
            headers: { "User-Agent": Globals.USER_AGENT },
            timeout: FICHUB_API_TIMEOUT_MS,
            onload: (res: FicHubTextResponse) => {
                if (res.status === 429) {
                    log("Fichub Server Busy (429).");
                    rejectOnce(new Error("429: Server Busy"));
                    return;
                }

                if (res.status < 200 || res.status >= 300) {
                    rejectOnce(new Error(`FicHub API request failed: HTTP ${res.status}`));
                    return;
                }

                try {
                    const data = JSON.parse(res.responseText || '{}');
                    const rel = data.urls?.[format] || data[format + '_url'];

                    if (typeof rel === 'string' && rel.length > 0) {
                        resolveOnce(rel.startsWith('http') ? rel : `https://fichub.net${rel}`);
                    } else {
                        log(`Format '${format}' not found in API response.`, data);
                        rejectOnce(new Error("Format not found"));
                    }
                } catch (e) {
                    rejectOnce(e);
                }
            },
            onerror: (err) => rejectOnce(err),
            ontimeout: () => rejectOnce(new Error(`FicHub API request timed out after ${FICHUB_API_TIMEOUT_MS}ms.`))
        });
    });
}

/**
 * Fetches the actual file content as a Blob.
 */
function _fetchBlob(url: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const resolveOnce = (blob: Blob) => { if (settled) return; settled = true; resolve(blob); };
        const rejectOnce = (err: unknown) => { if (settled) return; settled = true; reject(err); };

        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            headers: { Accept: "application/epub+zip,application/octet-stream,*/*" },
            responseType: "blob",
            timeout: FICHUB_FILE_TIMEOUT_MS,
            onload: (res: FicHubBinaryResponse) => {
                if (res.status !== 200) {
                    rejectOnce(new Error(`Download failed: ${res.status}`));
                    return;
                }

                const response = res.response;
                if (response instanceof Blob) {
                    resolveOnce(response);
                    return;
                }

                if (response instanceof ArrayBuffer) {
                    resolveOnce(new Blob([response], { type: EPUB_MIME_TYPE }));
                    return;
                }

                rejectOnce(new Error("FicHub returned no EPUB data."));
            },
            onerror: (err) => rejectOnce(err),
            ontimeout: () => rejectOnce(new Error(`FicHub EPUB download timed out after ${FICHUB_FILE_TIMEOUT_MS}ms.`))
        });
    });
}

function _withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            (value) => { window.clearTimeout(timer); resolve(value); },
            (err) => { window.clearTimeout(timer); reject(err); }
        );
    });
}

/**
 * Injects the cover image into the EPUB structure using JSZip.
 * Supports "Naked" EPUBs (FicHub default) by creating the necessary XML structure.
 * Only injects the thumbnail; does not create a cover page.
 *
 * Orchestrates: find OPF path → parse OPF → detect existing cover → replace or inject.
 */
async function _injectCoverIntoEpub(epubBlob: Blob, coverBlob: Blob): Promise<Blob> {
    const log = Core.getLogger(MODULE_NAME, 'injectCover');
    const zip = await JSZip.loadAsync(epubBlob);
    const coverMimeType = coverBlob.type || 'image/jpeg';

    const { opfPath, opfDir } = await _findOpfPath(zip);
    const opfDoc = await _parseOpfDocument(zip, opfPath);

    const existingHref = _findExistingCoverHref(opfDoc);

    if (existingHref) {
        log("Existing cover metadata found. Replacing file.");
        zip.file(_resolveFullPath(opfDir, existingHref), coverBlob);
    } else {
        log("No existing cover found. Injecting image and metadata.");
        _injectCoverMetadata(zip, opfPath, opfDir, coverBlob, coverMimeType, opfDoc);
    }

    // STORE: all entries were decompressed into memory by loadAsync.
    // Re-compressing them is pure CPU waste — the data was already DEFLATEd
    // by FicHub and we only touched the cover image + OPF.  STORE turns
    // generateAsync into a near-instant concatenation.  The output file is
    // larger (decompressed content), but the operation completes in seconds
    // instead of minutes for large multi-chapter EPUBs.
    return await zip.generateAsync({
        type: "blob",
        mimeType: EPUB_MIME_TYPE,
        compression: "STORE",
    });
}

/** Reads container.xml to locate the OPF file path within the EPUB ZIP. */
async function _findOpfPath(zip: JSZip): Promise<{ opfPath: string; opfDir: string }> {
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) throw new Error("Invalid EPUB: Missing container.xml");

    const container = await containerFile.async("text");
    const opfPathMatch = container.match(/full-path="([^"]+)"/);
    if (!opfPathMatch) throw new Error("Invalid EPUB: Cannot find OPF path");

    const opfPath = opfPathMatch[1];
    const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
    return { opfPath, opfDir };
}

/** Parses the OPF XML file from the ZIP into a DOM Document. */
async function _parseOpfDocument(zip: JSZip, opfPath: string): Promise<Document> {
    const opfFile = zip.file(opfPath);
    if (!opfFile) throw new Error(`Invalid EPUB: Missing OPF file at ${opfPath}`);

    const opfContent = await opfFile.async("text");
    const parser = new DOMParser();
    return parser.parseFromString(opfContent, "application/xml");
}

/**
 * Returns the href of an existing cover image in the OPF manifest, or null.
 * Looks for <meta name="cover"> → content attribute → <item id="..."> → href.
 */
export function _findExistingCoverHref(opfDoc: Document): string | null {
    const coverMeta = opfDoc.querySelector('meta[name="cover"]');
    if (!coverMeta) return null;

    const coverId = coverMeta.getAttribute("content");
    if (!coverId) return null;

    const item = opfDoc.getElementById(coverId) || opfDoc.querySelector(`item[id="${coverId}"]`);
    if (!item) return null;

    return item.getAttribute("href");
}

/** Resolves a manifest href (relative to OPF directory) to a full ZIP path. */
export function _resolveFullPath(opfDir: string, href: string): string {
    return opfDir ? `${opfDir}/${href}` : href;
}

/** Adds a cover image to the ZIP and updates OPF metadata + manifest. */
function _injectCoverMetadata(
    zip: JSZip,
    opfPath: string,
    opfDir: string,
    coverBlob: Blob,
    coverMimeType: string,
    opfDoc: Document
): void {
    const OPF_NS = "http://www.idpf.org/2007/opf";
    const COVER_IMAGE_ID = "cover-image";
    const COVER_IMG_FILENAME = `images/cover.${_imageExtensionForMimeType(coverMimeType)}`;

    const fullImgPath = opfDir ? `${opfDir}/${COVER_IMG_FILENAME}` : COVER_IMG_FILENAME;
    zip.file(fullImgPath, coverBlob);

    const metadata = opfDoc.getElementsByTagNameNS(OPF_NS, "metadata")[0];
    if (metadata) {
        const metaEl = opfDoc.createElementNS(OPF_NS, "meta");
        metaEl.setAttribute("name", "cover");
        metaEl.setAttribute("content", COVER_IMAGE_ID);
        metadata.appendChild(metaEl);
    }

    // Check OPF version — `properties` attr is EPUB 3+ only
    const packageEl = opfDoc.documentElement;
    const opfVersion = packageEl?.getAttribute('version') || '2.0';
    const isEpub3 = opfVersion.startsWith('3');

    const manifest = opfDoc.getElementsByTagNameNS(OPF_NS, "manifest")[0];
    if (manifest) {
        const itemImg = opfDoc.createElementNS(OPF_NS, "item");
        itemImg.setAttribute("id", COVER_IMAGE_ID);
        itemImg.setAttribute("href", COVER_IMG_FILENAME);
        itemImg.setAttribute("media-type", coverMimeType);
        if (isEpub3) {
            itemImg.setAttribute("properties", "cover-image");
        }
        manifest.appendChild(itemImg);
    }

    const serializer = new XMLSerializer();
    zip.file(opfPath, serializer.serializeToString(opfDoc));
}

function _imageExtensionForMimeType(mimeType: string): string {
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('gif')) return 'gif';
    if (mimeType.includes('webp')) return 'webp';
    return 'jpg';
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

export function _sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, "").trim();
}