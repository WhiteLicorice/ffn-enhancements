// modules/FicHubDownloader.ts

import { Core } from './Core';
import { IFanficDownloader } from '../interfaces/IFanficDownloader';
import { SupportedFormats } from '../enums/SupportedFormats';
import { FicHubStatus } from '../enums/FicHubStatus';
import { LocalMetadataSerializer } from '../serializers/LocalMetadataSerializer';
import { FicHubMetadataSerializer } from '../serializers/FicHubMetadataSerializer';
import { backgroundFetch, type FetchResponse } from '../platform/messaging';
import { blobToBytes, bytesToArrayBuffer, bytesToText, createZip, textToBytes, unzipBytes, type ZipFileEntry } from '../utils/zip';

const MODULE_NAME = 'FicHubDownloader';
const FICHUB_API_TIMEOUT_MS = 60_000;
const FICHUB_FILE_TIMEOUT_MS = 120_000;
const COVER_INJECTION_TIMEOUT_MS = 120_000;
const EPUB_MIME_TYPE = 'application/epub+zip';
const FICHUB_PERMISSION_MESSAGE = 'Enable access to fichub.net in extension permissions.';
const FICHUB_PERMISSION_ERROR_PATTERNS = [
    'permission',
    'permissions',
    'host',
    'access',
    'not allowed',
    'denied',
] as const;

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
            const dlUrl = await _getFicHubDownloadUrl(storyUrl, SupportedFormats.EPUB, onProgress);

            if (onProgress) onProgress("Fetching EPUB Data...");

            const epubBlob = await _fetchBlob(dlUrl);

            if (onProgress) onProgress("Scraping Local Cover...");

            const storyId = storyUrl.match(/\/s\/(\d+)/)?.[1] || "0";
            const serializer = new LocalMetadataSerializer(storyId, storyUrl);
            const metadata = await serializer.serialize();

            let finalBlob = epubBlob;
            const filename = `${metadata.title} - ${metadata.author}.epub`;

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

            if (onProgress) onProgress("Saving...");
            _saveBlob(finalBlob, _sanitizeFilename(filename));

        } catch (e) {
            log("EPUB Download Failed", e);
            throw e;
        }
    },

    downloadAsMOBI: function (storyUrl: string, onProgress?: CallableFunction): Promise<void> {
        return _processApiRequest(storyUrl, SupportedFormats.MOBI, onProgress);
    },

    downloadAsPDF: function (storyUrl: string, onProgress?: CallableFunction): Promise<void> {
        return _processApiRequest(storyUrl, SupportedFormats.PDF, onProgress);
    },

    downloadAsHTML: function (storyUrl: string, onProgress?: CallableFunction): Promise<void> {
        return _processApiRequest(storyUrl, SupportedFormats.HTML, onProgress);
    },
};

/**
 * Compares Local metadata against FicHub metadata to determine freshness.
 * Uses backgroundFetch (service worker proxy) to bypass CORS.
 */
export async function checkFicHubFreshness(
    storyUrl: string,
    localMeta: LocalMetadataSerializer
): Promise<FicHubStatus> {
    const log = Core.getLogger(MODULE_NAME, 'checkFreshness');

    try {
        const apiUrl = `https://fichub.net/api/v0/meta?q=${encodeURIComponent(storyUrl)}`;
        const response = await backgroundFetch({
            url: apiUrl,
            method: 'GET',
            timeout: FICHUB_API_TIMEOUT_MS,
        });

        if (!response.ok || typeof response.data !== 'string') {
            log(`API Error: ${response.status}`);
            return FicHubStatus.ERROR;
        }

        const jsonData = JSON.parse(response.data);
        const ficHubMeta = new FicHubMetadataSerializer(jsonData);

        if (!ficHubMeta.getUpdatedDate() || !ficHubMeta.getChapterCount()) {
            return FicHubStatus.ERROR;
        }

        const localCount = localMeta.getChapterCount();
        const ficHubCount = ficHubMeta.getChapterCount();

        const localDate = localMeta.getUpdatedDate();
        const ficHubDate = ficHubMeta.getUpdatedDate();

        log(`Local: ${localCount} ch / ${localDate.toISOString()} | FicHub: ${ficHubCount} ch / ${ficHubDate.toISOString()}`);

        if (ficHubCount != localCount) {
            log(`FicHub Stale: Missing chapters (Hub: ${ficHubCount} vs Page: ${localCount})`);
            return FicHubStatus.STALE;
        }

        const ONE_DAY = 86400000;
        if (localDate.getTime() > (ficHubDate.getTime() + ONE_DAY)) {
            log(`FicHub Stale: Content on page is significantly newer (>24h) than Hub cache.`);
            return FicHubStatus.STALE;
        }

        return FicHubStatus.FRESH;
    } catch (e) {
        log("Freshness check failed.", e);
        return FicHubStatus.ERROR;
    }
}

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

export async function _getFicHubDownloadUrl(
    storyUrl: string,
    format: SupportedFormats,
    onProgress?: CallableFunction,
): Promise<string> {
    const log = Core.getLogger(MODULE_NAME, 'getDownloadUrl');
    const apiUrl = `https://fichub.net/api/v0/epub?q=${encodeURIComponent(storyUrl)}`;

    log(`Initiating API request for ${format}: ${apiUrl}`);
    if (onProgress) onProgress("Requesting...");

    const response = await backgroundFetch({
        url: apiUrl,
        method: 'GET',
        timeout: FICHUB_API_TIMEOUT_MS,
    });

    if (response.status === 429) {
        log("Fichub Server Busy (429).");
        throw new Error("429: Server Busy");
    }

    if (!response.ok || typeof response.data !== 'string') {
        throw _buildFicHubRequestError(response, `FicHub API request failed: HTTP ${response.status}`);
    }

    const data = JSON.parse(response.data || '{}');
    const rel = data.urls?.[format] || data[format + '_url'];

    if (typeof rel === 'string' && rel.length > 0) {
        return rel.startsWith('http') ? rel : `https://fichub.net${rel}`;
    }

    log(`Format '${format}' not found in API response.`, data);
    throw new Error("Format not found");
}

export async function _fetchBlob(url: string): Promise<Blob> {
    const response = await backgroundFetch({
        url,
        method: 'GET',
        headers: { Accept: "application/epub+zip,application/octet-stream,*/*" },
        responseType: 'blob',
        timeout: FICHUB_FILE_TIMEOUT_MS,
    });

    if (!response.ok) {
        throw _buildFicHubRequestError(response, `Download failed: ${response.status}`);
    }

    if (response.data instanceof Blob) {
        return response.data;
    }

    throw new Error("FicHub returned no EPUB data.");
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

export async function _injectCoverIntoEpub(epubBlob: Blob, coverBlob: Blob): Promise<Blob> {
    const log = Core.getLogger(MODULE_NAME, 'injectCover');
    const zipEntries = unzipBytes(await blobToBytes(epubBlob));
    const coverBytes = await blobToBytes(coverBlob);
    const coverMimeType = coverBlob.type || 'image/jpeg';

    const { opfPath, opfDir } = _findOpfPath(zipEntries);
    const opfDoc = _parseOpfDocument(zipEntries, opfPath);

    const existingHref = _findExistingCoverHref(opfDoc);

    if (existingHref) {
        log("Existing cover metadata found. Replacing file.");
        zipEntries[_resolveFullPath(opfDir, existingHref)] = coverBytes;
    } else {
        log("No existing cover found. Injecting image and metadata.");
        _injectCoverMetadata(zipEntries, opfPath, opfDir, coverBytes, coverMimeType, opfDoc);
    }

    return new Blob([bytesToArrayBuffer(createZip(_createStoredZipEntries(zipEntries)))], { type: EPUB_MIME_TYPE });
}

function _findOpfPath(zipEntries: Record<string, Uint8Array>): { opfPath: string; opfDir: string } {
    const containerFile = zipEntries["META-INF/container.xml"];
    if (!containerFile) throw new Error("Invalid EPUB: Missing container.xml");

    const container = bytesToText(containerFile);
    const opfPathMatch = container.match(/full-path="([^"]+)"/);
    if (!opfPathMatch) throw new Error("Invalid EPUB: Cannot find OPF path");

    const opfPath = opfPathMatch[1];
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';
    return { opfPath, opfDir };
}

function _parseOpfDocument(zipEntries: Record<string, Uint8Array>, opfPath: string): Document {
    const opfFile = zipEntries[opfPath];
    if (!opfFile) throw new Error(`Invalid EPUB: Missing OPF file at ${opfPath}`);

    const parser = new DOMParser();
    return parser.parseFromString(bytesToText(opfFile), "application/xml");
}

export function _findExistingCoverHref(opfDoc: Document): string | null {
    const coverMeta = opfDoc.querySelector('meta[name="cover"]');
    if (!coverMeta) return null;

    const coverId = coverMeta.getAttribute("content");
    if (!coverId) return null;

    const item = opfDoc.getElementById(coverId) || opfDoc.querySelector(`item[id="${coverId}"]`);
    if (!item) return null;

    return item.getAttribute("href");
}

export function _resolveFullPath(opfDir: string, href: string): string {
    return opfDir ? `${opfDir}/${href}` : href;
}

function _injectCoverMetadata(
    zipEntries: Record<string, Uint8Array>,
    opfPath: string,
    opfDir: string,
    coverBytes: Uint8Array,
    coverMimeType: string,
    opfDoc: Document
): void {
    const OPF_NS = "http://www.idpf.org/2007/opf";
    const COVER_IMAGE_ID = "cover-image";
    const COVER_IMG_FILENAME = `images/cover.${_imageExtensionForMimeType(coverMimeType)}`;

    const fullImgPath = opfDir ? `${opfDir}/${COVER_IMG_FILENAME}` : COVER_IMG_FILENAME;
    zipEntries[fullImgPath] = coverBytes;

    const metadata = opfDoc.getElementsByTagNameNS(OPF_NS, "metadata")[0];
    if (metadata) {
        const metaEl = opfDoc.createElementNS(OPF_NS, "meta");
        metaEl.setAttribute("name", "cover");
        metaEl.setAttribute("content", COVER_IMAGE_ID);
        metadata.appendChild(metaEl);
    }

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
    zipEntries[opfPath] = textToBytes(serializer.serializeToString(opfDoc));
}

function _createStoredZipEntries(zipEntries: Record<string, Uint8Array>): ZipFileEntry[] {
    const entries: ZipFileEntry[] = [];

    if (zipEntries['mimetype']) {
        entries.push({ path: 'mimetype', data: zipEntries['mimetype'], options: { level: 0 } });
    }

    Object.keys(zipEntries)
        .filter((path) => path !== 'mimetype')
        .sort()
        .forEach((path) => {
            entries.push({ path, data: zipEntries[path], options: { level: 0 } });
        });

    return entries;
}

function _buildFicHubRequestError(response: FetchResponse, defaultMessage: string): Error {
    if (_isFicHubPermissionError(response)) {
        return new Error(FICHUB_PERMISSION_MESSAGE);
    }

    return new Error(defaultMessage);
}

function _isFicHubPermissionError(response: FetchResponse): boolean {
    const error = response.error?.toLowerCase() ?? '';
    return response.status === 0 && FICHUB_PERMISSION_ERROR_PATTERNS.some((pattern) => error.includes(pattern));
}

function _imageExtensionForMimeType(mimeType: string): string {
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('gif')) return 'gif';
    if (mimeType.includes('webp')) return 'webp';
    return 'jpg';
}

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
