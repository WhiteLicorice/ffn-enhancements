import { describe, expect, it } from 'vitest';

import { blobToBytes, bytesToText, createZip, textToBytes, unzipBytes } from '../utils/zip';

describe('zip helpers', () => {
    it('round-trips stored and deflated files', async () => {
        const archive = createZip([
            { path: 'mimetype', data: textToBytes('application/epub+zip'), options: { level: 0 } },
            { path: 'OEBPS/content.opf', data: textToBytes('<package/>'), options: { level: 1 } },
        ]);

        const files = unzipBytes(archive);

        expect(bytesToText(files['mimetype'])).toBe('application/epub+zip');
        expect(bytesToText(files['OEBPS/content.opf'])).toBe('<package/>');
    });

    it('converts blobs into zip-ready bytes', async () => {
        const bytes = await blobToBytes(new Blob(['cover-bytes'], { type: 'image/jpeg' }));

        expect(bytesToText(bytes)).toBe('cover-bytes');
    });
});
