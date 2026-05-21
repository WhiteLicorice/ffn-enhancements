import { beforeEach, describe, expect, it } from 'vitest';
import './__mocks__/browser';
import { mockChromePermissions, mockChromeRuntime } from './__mocks__/browser';
import { MessageType, type EnsureFicHubPermissionResponse } from '../background/message-types';
import { _ensureFicHubPermission, _sanitizeFilename, _resolveFullPath, _findExistingCoverHref } from '../modules/FicHubDownloader';

// ─── _sanitizeFilename ────────────────────────────────────────────────────

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

    it('handles empty string', () => {
        expect(_sanitizeFilename('')).toBe('');
    });

    it('handles string of only invalid chars', () => {
        expect(_sanitizeFilename('<>:"/\\|?*')).toBe('');
    });
});

// ─── _resolveFullPath ─────────────────────────────────────────────────────

describe('_resolveFullPath', () => {
    it('returns href only when opfDir is empty', () => {
        expect(_resolveFullPath('', 'image.jpg')).toBe('image.jpg');
    });

    it('joins opfDir and href with slash', () => {
        expect(_resolveFullPath('OEBPS', 'images/cover.jpg')).toBe('OEBPS/images/cover.jpg');
    });

    it('works with nested directories', () => {
        expect(_resolveFullPath('EPUB/content', 'images/cover.jpg')).toBe('EPUB/content/images/cover.jpg');
    });

    it('preserves href with leading directories', () => {
        expect(_resolveFullPath('OEBPS', '../Images/cover.jpg')).toBe('OEBPS/../Images/cover.jpg');
    });
});

// ─── _findExistingCoverHref ───────────────────────────────────────────────

describe('_findExistingCoverHref', () => {
    function opfDocWithCover(coverId: string, coverHref: string): Document {
        const parser = new DOMParser();
        const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
    <metadata>
        <meta name="cover" content="${coverId}"/>
    </metadata>
    <manifest>
        <item id="${coverId}" href="${coverHref}" media-type="image/jpeg"/>
    </manifest>
</package>`;
        return parser.parseFromString(xml, 'application/xml');
    }

    function opfDocWithoutCover(): Document {
        const parser = new DOMParser();
        const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
    <metadata/>
    <manifest/>
</package>`;
        return parser.parseFromString(xml, 'application/xml');
    }

    it('returns href when cover meta and item exist', () => {
        const doc = opfDocWithCover('cover-img', 'images/cover.jpg');
        expect(_findExistingCoverHref(doc)).toBe('images/cover.jpg');
    });

    it('returns null when no cover meta tag', () => {
        const doc = opfDocWithoutCover();
        expect(_findExistingCoverHref(doc)).toBeNull();
    });

    it('returns null when cover meta exists but item missing', () => {
        const parser = new DOMParser();
        const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
    <metadata>
        <meta name="cover" content="missing-item"/>
    </metadata>
    <manifest/>
</package>`;
        const doc = parser.parseFromString(xml, 'application/xml');
        expect(_findExistingCoverHref(doc)).toBeNull();
    });

    it('returns null when cover meta has no content attribute', () => {
        const parser = new DOMParser();
        const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
    <metadata>
        <meta name="cover"/>
    </metadata>
</package>`;
        const doc = parser.parseFromString(xml, 'application/xml');
        expect(_findExistingCoverHref(doc)).toBeNull();
    });

    it('finds cover item by id even in presence of other items', () => {
        const parser = new DOMParser();
        const xml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
    <metadata>
        <meta name="cover" content="cov"/>
    </metadata>
    <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="cov" href="images/cover.jpg" media-type="image/jpeg"/>
        <item id="chap1" href="chapter_1.xhtml" media-type="application/xhtml+xml"/>
    </manifest>
</package>`;
        const doc = parser.parseFromString(xml, 'application/xml');
        expect(_findExistingCoverHref(doc)).toBe('images/cover.jpg');
    });
});

describe('_ensureFicHubPermission', () => {
    beforeEach(() => {
        mockChromeRuntime._reset();
        mockChromePermissions._reset();
        document.body.innerHTML = '';
    });

    function installPermissionResponder(response: EnsureFicHubPermissionResponse): void {
        const chromeApi = (globalThis as unknown as {
            chrome: {
                runtime: {
                    onMessage: {
                        addListener(listener: (
                            message: unknown,
                            sender: unknown,
                            sendResponse: (response: unknown) => void,
                        ) => unknown): void;
                    };
                };
            };
        }).chrome;

        chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if ((message as { type?: string }).type !== MessageType.ENSURE_FICHUB_PERMISSION) {
                return undefined;
            }
            sendResponse(response);
            return true;
        });
    }

    it('asks the background context to ensure FicHub permission', async () => {
        installPermissionResponder({ ok: true, granted: true });

        const granted = await _ensureFicHubPermission();

        expect(granted).toBe(true);
        expect(document.getElementById('ffne-fichub-permission-toast')).toBeNull();
        expect(mockChromePermissions.state.requestCalls).toEqual([]);
    });

    it('shows a denial toast when the background context cannot grant permission', async () => {
        installPermissionResponder({ ok: true, granted: false });

        const granted = await _ensureFicHubPermission();

        expect(granted).toBe(false);
        expect(document.getElementById('ffne-fichub-permission-toast')?.textContent)
            .toBe('Allow access to fichub.net to enable downloads.');
    });
});
