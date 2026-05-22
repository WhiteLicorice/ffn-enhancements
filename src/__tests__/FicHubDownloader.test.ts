import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/messaging', () => ({
    backgroundFetch: vi.fn(),
}));

import {
    _fetchBlob,
    _findExistingCoverHref,
    _getFicHubDownloadUrl,
    _injectCoverIntoEpub,
    _resolveFullPath,
    _sanitizeFilename,
} from '../modules/FicHubDownloader';
import { SupportedFormats } from '../enums/SupportedFormats';
import { backgroundFetch } from '../platform/messaging';
import { blobToBytes, bytesToArrayBuffer, bytesToText, createZip, textToBytes, unzipBytes, type ZipFileEntry } from '../utils/zip';

const backgroundFetchMock = vi.mocked(backgroundFetch);

function makeEpubBlob(opf: string, extraEntries: Record<string, Uint8Array>): Blob {
    const entries: ZipFileEntry[] = [
        { path: 'mimetype', data: textToBytes('application/epub+zip'), options: { level: 0 } },
        {
            path: 'META-INF/container.xml',
            data: textToBytes(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`),
            options: { level: 0 },
        },
        { path: 'OEBPS/content.opf', data: textToBytes(opf), options: { level: 0 } },
        ...Object.entries(extraEntries).map<ZipFileEntry>(([path, data]) => ({ path, data, options: { level: 0 } })),
    ];

    return new Blob([bytesToArrayBuffer(createZip(entries))], { type: 'application/epub+zip' });
}

describe('_sanitizeFilename', () => {
    it('removes invalid Windows filename characters', () => {
        expect(_sanitizeFilename('file<name>.epub')).toBe('filename.epub');
        expect(_sanitizeFilename('a:b.epub')).toBe('ab.epub');
        expect(_sanitizeFilename('test"file.epub')).toBe('testfile.epub');
        expect(_sanitizeFilename('one/two.epub')).toBe('onetwo.epub');
        expect(_sanitizeFilename('a\\b.epub')).toBe('ab.epub');
        expect(_sanitizeFilename('a|b.epub')).toBe('ab.epub');
        expect(_sanitizeFilename('a?b.epub')).toBe('ab.epub');
        expect(_sanitizeFilename('a*b.epub')).toBe('ab.epub');
    });

    it('trims leading and trailing whitespace', () => {
        expect(_sanitizeFilename('  file.epub  ')).toBe('file.epub');
        expect(_sanitizeFilename('\t file.epub\n')).toBe('file.epub');
    });

    it('preserves clean filenames unchanged', () => {
        expect(_sanitizeFilename('Story - Author.epub')).toBe('Story - Author.epub');
        expect(_sanitizeFilename('Chapter_01.md')).toBe('Chapter_01.md');
    });
});

describe('_resolveFullPath', () => {
    it('returns href only when opfDir is empty', () => {
        expect(_resolveFullPath('', 'image.jpg')).toBe('image.jpg');
    });

    it('joins opfDir and href with slash', () => {
        expect(_resolveFullPath('OEBPS', 'images/cover.jpg')).toBe('OEBPS/images/cover.jpg');
    });
});

describe('_findExistingCoverHref', () => {
    it('returns href when cover meta and item exist', () => {
        const doc = new DOMParser().parseFromString(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
    <metadata>
        <meta name="cover" content="cover-img"/>
    </metadata>
    <manifest>
        <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    </manifest>
</package>`, 'application/xml');

        expect(_findExistingCoverHref(doc)).toBe('images/cover.jpg');
    });

    it('returns null when no cover metadata exists', () => {
        const doc = new DOMParser().parseFromString(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
    <metadata/>
    <manifest/>
</package>`, 'application/xml');

        expect(_findExistingCoverHref(doc)).toBeNull();
    });
});

describe('_getFicHubDownloadUrl', () => {
    beforeEach(() => {
        backgroundFetchMock.mockReset();
    });

    it('extracts relative format URLs from the API response', async () => {
        backgroundFetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            data: JSON.stringify({ urls: { epub: '/downloads/story.epub' } }),
            finalUrl: 'https://fichub.net/api/v0/epub?q=test',
        });

        await expect(_getFicHubDownloadUrl('https://www.fanfiction.net/s/1/1/Test', SupportedFormats.EPUB))
            .resolves
            .toBe('https://fichub.net/downloads/story.epub');
    });

    it('preserves absolute format URLs from the API response', async () => {
        backgroundFetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            data: JSON.stringify({ pdf_url: 'https://cdn.fichub.net/story.pdf' }),
            finalUrl: 'https://fichub.net/api/v0/epub?q=test',
        });

        await expect(_getFicHubDownloadUrl('https://www.fanfiction.net/s/1/1/Test', SupportedFormats.PDF))
            .resolves
            .toBe('https://cdn.fichub.net/story.pdf');
    });

    it('surfaces host-access guidance for permission-like fetch failures', async () => {
        backgroundFetchMock.mockResolvedValue({
            ok: false,
            status: 0,
            data: null,
            finalUrl: 'https://fichub.net/api/v0/epub?q=test',
            error: 'Access to fetch at "https://fichub.net" is not allowed',
        });

        await expect(_getFicHubDownloadUrl('https://www.fanfiction.net/s/1/1/Test', SupportedFormats.EPUB))
            .rejects
            .toThrow('Enable access to fichub.net in extension permissions.');
    });
});

describe('_fetchBlob', () => {
    beforeEach(() => {
        backgroundFetchMock.mockReset();
    });

    it('returns EPUB blobs from background fetch responses', async () => {
        backgroundFetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            data: new Blob(['epub'], { type: 'application/epub+zip' }),
            finalUrl: 'https://fichub.net/download.epub',
        });

        const blob = await _fetchBlob('https://fichub.net/download.epub');

        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('application/epub+zip');
    });

    it('surfaces host-access guidance for permission-like blob failures', async () => {
        backgroundFetchMock.mockResolvedValue({
            ok: false,
            status: 0,
            data: null,
            finalUrl: 'https://fichub.net/download.epub',
            error: 'Missing host permission for the requested resource',
        });

        await expect(_fetchBlob('https://fichub.net/download.epub'))
            .rejects
            .toThrow('Enable access to fichub.net in extension permissions.');
    });
});

describe('_injectCoverIntoEpub', () => {
    it('replaces an existing cover file', async () => {
        const original = makeEpubBlob(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
    <metadata>
        <meta name="cover" content="cover-image"/>
    </metadata>
    <manifest>
        <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>
    </manifest>
</package>`, {
            'OEBPS/images/cover.jpg': textToBytes('old-cover'),
        });

        const updated = await _injectCoverIntoEpub(original, new Blob(['new-cover'], { type: 'image/jpeg' }));
        const zip = unzipBytes(await blobToBytes(updated));

        expect(bytesToText(zip['OEBPS/images/cover.jpg'])).toBe('new-cover');
        expect(bytesToText(zip['mimetype'])).toBe('application/epub+zip');
    });

    it('injects a new cover image and OPF metadata when missing', async () => {
        const original = makeEpubBlob(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
    <metadata/>
    <manifest/>
</package>`, {});

        const updated = await _injectCoverIntoEpub(original, new Blob(['cover-bytes'], { type: 'image/png' }));
        const zip = unzipBytes(await blobToBytes(updated));
        const opf = bytesToText(zip['OEBPS/content.opf']);

        expect(bytesToText(zip['OEBPS/images/cover.png'])).toBe('cover-bytes');
        expect(opf).toContain('name="cover"');
        expect(opf).toContain('id="cover-image"');
        expect(opf).toContain('properties="cover-image"');
    });
});
