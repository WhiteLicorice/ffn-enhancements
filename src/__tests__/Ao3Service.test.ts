import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ao3Service } from '../services/Ao3Service';
import type { IAo3Chapter } from '../interfaces/IAo3Migration';
import { GM_xmlhttpRequest } from '$';

function makeChapter(): IAo3Chapter {
    return {
        workId: '77945481',
        chapterId: '123456789',
        chapterNumber: 1,
        label: 'Chapter 1: Beginnings',
        title: 'Beginnings',
        readerUrl: 'https://archiveofourown.org/works/77945481/chapters/123456789',
        editUrl: 'https://archiveofourown.org/works/77945481/chapters/123456789/edit',
    };
}

function queueTextResponses(responses: Array<{ status?: number; responseText: string; finalUrl?: string }>) {
    vi.mocked(GM_xmlhttpRequest).mockImplementation((options: any) => {
        const next = responses.shift();
        if (!next) throw new Error('No queued GM_xmlhttpRequest response.');
        options.onload?.({
            status: next.status ?? 200,
            responseText: next.responseText,
            finalUrl: next.finalUrl ?? options.url,
        });
        return {
            abort: vi.fn(),
        } as any;
    });
}

describe('Ao3Service', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.mocked(GM_xmlhttpRequest).mockReset();
    });

    it('normalizes base, chapter, edit, and navigate AO3 work URLs', () => {
        expect(Ao3Service.normalizeWorkUrl('https://archiveofourown.org/works/77945481')).toBe('https://archiveofourown.org/works/77945481');
        expect(Ao3Service.normalizeWorkUrl('https://archiveofourown.org/works/77945481/chapters/123456789')).toBe('https://archiveofourown.org/works/77945481');
        expect(Ao3Service.normalizeWorkUrl('https://archiveofourown.org/works/77945481/chapters/123456789/edit')).toBe('https://archiveofourown.org/works/77945481');
        expect(Ao3Service.normalizeWorkUrl('https://archiveofourown.org/works/77945481/navigate?view_adult=true')).toBe('https://archiveofourown.org/works/77945481');
    });

    it('blocks migration when AO3 navigate response is logged out', async () => {
        queueTextResponses([{
            responseText: `
                <html>
                    <body>
                        <ol class="chapter index group">
                            <li><a href="/works/77945481/chapters/123456789">Beginnings</a></li>
                        </ol>
                    </body>
                </html>
            `,
        }]);

        const result = await Ao3Service.fetchChapterIndex('https://archiveofourown.org/works/77945481');

        expect(result.ok).toBe(false);
        expect(result.reason).toContain('login');
    });

    it('parses chapter index links from AO3 navigate HTML', () => {
        const doc = new DOMParser().parseFromString(`
            <html>
                <body class="logged-in">
                    <ol class="chapter index group">
                        <li><a href="/works/77945481/chapters/123456789">Beginnings</a></li>
                        <li><a href="/works/77945481/chapters/223456789">Middle Game</a></li>
                    </ol>
                </body>
            </html>
        `, 'text/html');

        const chapters = Ao3Service._parseChapterIndex(doc, 'https://archiveofourown.org/works/77945481');

        expect(chapters).toEqual([
            {
                workId: '77945481',
                chapterId: '123456789',
                chapterNumber: 1,
                label: 'Chapter 1: Beginnings',
                title: 'Beginnings',
                readerUrl: 'https://archiveofourown.org/works/77945481/chapters/123456789',
                editUrl: 'https://archiveofourown.org/works/77945481/chapters/123456789/edit',
            },
            {
                workId: '77945481',
                chapterId: '223456789',
                chapterNumber: 2,
                label: 'Chapter 2: Middle Game',
                title: 'Middle Game',
                readerUrl: 'https://archiveofourown.org/works/77945481/chapters/223456789',
                editUrl: 'https://archiveofourown.org/works/77945481/chapters/223456789/edit',
            },
        ]);
    });

    it('parses the edit form fields and content textarea', () => {
        const doc = new DOMParser().parseFromString(`
            <html>
                <body class="logged-in">
                    <form action="/works/77945481/chapters/123456789" method="post" class="edit_chapter">
                        <input type="hidden" name="authenticity_token" value="secret-token">
                        <input type="hidden" name="_method" value="patch">
                        <input type="hidden" name="chapter[position]" value="1">
                        <textarea id="content" name="chapter[content]">Old body</textarea>
                        <input type="submit" name="update_button" value="Update">
                    </form>
                </body>
            </html>
        `, 'text/html');

        const payload = Ao3Service._buildUpdatePayload(doc, makeChapter(), '<p>Replacement</p>');

        expect(payload.ok).toBe(true);
        expect(payload.actionUrl).toBe('https://archiveofourown.org/works/77945481/chapters/123456789');
        const params = new URLSearchParams(payload.body);
        expect(params.get('_method')).toBe('patch');
        expect(params.get('authenticity_token')).toBe('secret-token');
        expect(params.get('chapter[position]')).toBe('1');
        expect(params.get('chapter[content]')).toBe('<p>Replacement</p>');
        expect(params.get('update_button')).toBe('Update');
    });

    it('posts the native AO3 form payload and detects reader-page success', async () => {
        const chapter = makeChapter();
        queueTextResponses([
            {
                responseText: `
                    <html>
                        <body class="logged-in">
                            <form action="/works/77945481/chapters/123456789" method="post" class="edit_chapter">
                                <input type="hidden" name="authenticity_token" value="secret-token">
                                <input type="hidden" name="_method" value="patch">
                                <input type="hidden" name="chapter[position]" value="1">
                                <textarea id="content" name="chapter[content]">Old body</textarea>
                                <input type="submit" name="update_button" value="Update">
                            </form>
                        </body>
                    </html>
                `,
            },
            {
                responseText: `
                    <html>
                        <body class="logged-in">
                            <div id="chapters">
                                <div id="chapter-123456789">
                                    <div class="userstuff">New body</div>
                                </div>
                            </div>
                        </body>
                    </html>
                `,
                finalUrl: chapter.readerUrl,
            },
        ]);

        const result = await Ao3Service.updateChapterContent(chapter, '<p>Replacement</p>');

        expect(result).toEqual({ ok: true });
        const postCall = vi.mocked(GM_xmlhttpRequest).mock.calls[1]?.[0] as any;
        expect(postCall.method).toBe('POST');
        expect(postCall.url).toBe('https://archiveofourown.org/works/77945481/chapters/123456789');
        const params = new URLSearchParams(postCall.data);
        expect(params.get('_method')).toBe('patch');
        expect(params.get('authenticity_token')).toBe('secret-token');
        expect(params.get('chapter[position]')).toBe('1');
        expect(params.get('chapter[content]')).toBe('<p>Replacement</p>');
        expect(params.get('update_button')).toBe('Update');
    });

    it('detects AO3 failure responses after update attempts', async () => {
        const chapter = makeChapter();
        queueTextResponses([
            {
                responseText: `
                    <html>
                        <body class="logged-in">
                            <form action="/works/77945481/chapters/123456789" method="post" class="edit_chapter">
                                <input type="hidden" name="authenticity_token" value="secret-token">
                                <input type="hidden" name="_method" value="patch">
                                <textarea id="content" name="chapter[content]">Old body</textarea>
                                <input type="submit" name="update_button" value="Update">
                            </form>
                        </body>
                    </html>
                `,
            },
            {
                responseText: `
                    <html>
                        <body class="logged-in">
                            <div class="error">Chapter update failed.</div>
                            <form class="edit_chapter">
                                <textarea id="content" name="chapter[content]">Old body</textarea>
                            </form>
                        </body>
                    </html>
                `,
                finalUrl: chapter.editUrl,
            },
        ]);

        const result = await Ao3Service.updateChapterContent(chapter, '<p>Replacement</p>');

        expect(result.ok).toBe(false);
        expect(result.reason).toContain('Chapter update failed');
    });
});
