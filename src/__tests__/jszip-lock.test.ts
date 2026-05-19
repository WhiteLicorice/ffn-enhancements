// JSZip is pinned to exactly 3.1.5.  Do NOT upgrade it.
//
// JSZip >=3.2.0 bundled by Vite deadlocks in the Tampermonkey sandbox:
// `generateAsync` never resolves.  Both `type: "blob"` and `type: "arraybuffer"`
// are affected in newer versions.  The hang is silent — no error, no timeout —
// so the EPUB download just spins forever.
//
// Before commit b9cd28c ("Implement hardening changes"), JSZip 3.1.5 was loaded
// from cdnjs via a @require directive + externalGlobals.  That commit removed
// the CDN approach; Vite then bundled npm's jszip@^3.1.5 which resolved to
// 3.10.1, introducing the deadlock.
//
// The following call sites are protected by this lock:
//   - EpubBuilder.build()       — Native Downloader EPUB generation
//   - _injectCoverIntoEpub()    — FicHub cover injection
//   - DocxBuilder._buildZip()   — DOCX export
//   - _docxToImportHtml()       — DOCX import
//
// All use `generateAsync({ type: "arraybuffer" })` + manual `new Blob([...])`
// because JSZip 3.1.5's `type: "blob"` is also unreliable when bundled by Vite
// (it works from CDN but not as a bundled ESM dependency).
//
// If you must change the JSZip version, run this test file in a real
// Tampermonkey environment (not just Vitest/node) before merging.

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';

describe('JSZip version lock', () => {
    it('is pinned to exactly 3.1.5', () => {
        const version = JSZip.version;
        expect(version).toBe('3.1.5');
    });

    it('generateAsync with EpubBuilder config completes without hanging', async () => {
        const zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        zip.file('META-INF/container.xml', '<container/>');
        zip.file('OEBPS/test.xhtml', '<html><body>hello</body></html>');

        const bytes = await zip.generateAsync({
            type: 'arraybuffer',
            mimeType: 'application/epub+zip',
            compression: 'DEFLATE',
            compressionOptions: { level: 1 },
        });

        expect(bytes).toBeInstanceOf(ArrayBuffer);
        expect(bytes.byteLength).toBeGreaterThan(0);
    });

    it('generateAsync with FicHub cover injection config completes without hanging', async () => {
        const zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        zip.file('META-INF/container.xml', '<container/>');
        zip.file('OEBPS/content.opf', '<opf/>');
        zip.file('OEBPS/test.xhtml', '<html><body>hello</body></html>');

        const bytes = await zip.generateAsync({
            type: 'arraybuffer',
            mimeType: 'application/epub+zip',
            compression: 'STORE',
        });

        expect(bytes).toBeInstanceOf(ArrayBuffer);
        expect(bytes.byteLength).toBeGreaterThan(0);
    });

    it('loadAsync + generateAsync round-trip (FicHub cover inject simulation)', async () => {
        // Build a small EPUB-like ZIP
        const builder = new JSZip();
        builder.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        builder.file('META-INF/container.xml', '<container/>');
        builder.file('OEBPS/content.opf', '<opf/>');
        builder.file('OEBPS/chapter.xhtml', '<html><body>test content</body></html>');
        const epubBytes = await builder.generateAsync({ type: 'arraybuffer' });

        // Simulate _injectCoverIntoEpub: load, modify, regenerate with STORE
        const zip = await JSZip.loadAsync(epubBytes);
        zip.file('OEBPS/images/cover.jpg', new Uint8Array([1, 2, 3]));
        const resultBytes = await zip.generateAsync({
            type: 'arraybuffer',
            mimeType: 'application/epub+zip',
            compression: 'STORE',
        });

        expect(resultBytes).toBeInstanceOf(ArrayBuffer);
        expect(resultBytes.byteLength).toBeGreaterThan(epubBytes.byteLength); // cover added bytes

        // Verify the round-tripped ZIP is valid and readable
        const reopened = await JSZip.loadAsync(resultBytes);
        expect(reopened.file('OEBPS/images/cover.jpg')).toBeTruthy();
        const coverContent = await reopened.file('OEBPS/images/cover.jpg')!.async('uint8array');
        expect(Array.from(coverContent)).toEqual([1, 2, 3]);
    });
});
