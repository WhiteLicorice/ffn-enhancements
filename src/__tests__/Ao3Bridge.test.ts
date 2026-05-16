import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GM_getValue, GM_setValue } from '$';
import { Ao3Bridge } from '../modules/Ao3Bridge';
import type { IAo3Chapter } from '../interfaces/IAo3Migration';
import {
    AO3_BRIDGE_REQUEST_KEY,
    AO3_BRIDGE_RESULT_KEY,
    parseAo3BridgeResult,
    serializeAo3BridgeRequest,
} from '../interfaces/IAo3Bridge';

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

function response(status: number, body: string, url: string): Response {
    return {
        status,
        url,
        text: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
}

describe('Ao3Bridge', () => {
    const storage = new Map<string, unknown>();

    beforeEach(() => {
        storage.clear();
        document.body.innerHTML = '';
        document.body.className = 'logged-in';
        Ao3Bridge._initialized = false;
        Ao3Bridge._activeRequestId = null;
        Ao3Bridge._lastHandledRequestId = null;
        if (Ao3Bridge._heartbeatTimer !== null) {
            window.clearInterval(Ao3Bridge._heartbeatTimer);
            Ao3Bridge._heartbeatTimer = null;
        }

        vi.mocked(GM_getValue).mockImplementation((key: string) => storage.get(key));
        vi.mocked(GM_setValue).mockImplementation((key: string, value: unknown) => {
            storage.set(key, value);
        });
    });

    afterEach(() => {
        if (Ao3Bridge._heartbeatTimer !== null) {
            window.clearInterval(Ao3Bridge._heartbeatTimer);
            Ao3Bridge._heartbeatTimer = null;
        }
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.className = '';
        document.body.innerHTML = '';
    });

    it('loads AO3 chapters through same-origin fetch', async () => {
        storage.set(AO3_BRIDGE_REQUEST_KEY, serializeAo3BridgeRequest({
            id: 'load-1',
            kind: 'loadChapterIndex',
            createdAt: Date.now(),
            workUrl: 'https://archiveofourown.org/works/77945481',
        }));
        const fetchMock = vi.fn().mockResolvedValue(response(200, `
            <html>
                <body class="logged-in">
                    <ol class="chapter index group">
                        <li><a href="/works/77945481/chapters/123456789">Beginnings</a></li>
                    </ol>
                </body>
            </html>
        `, 'https://archiveofourown.org/works/77945481/navigate'));
        vi.stubGlobal('fetch', fetchMock);

        await Ao3Bridge._processPendingRequest();

        const result = parseAo3BridgeResult(storage.get(AO3_BRIDGE_RESULT_KEY));
        expect(result).toEqual({
            id: 'load-1',
            kind: 'loadChapterIndex',
            ok: true,
            chapters: [makeChapter()],
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://archiveofourown.org/works/77945481/navigate',
            expect.objectContaining({ credentials: 'same-origin', method: 'GET' }),
        );
    });

    it('updates AO3 chapter content through same-origin fetch', async () => {
        const chapter = makeChapter();
        storage.set(AO3_BRIDGE_REQUEST_KEY, serializeAo3BridgeRequest({
            id: 'update-1',
            kind: 'updateChapterContent',
            createdAt: Date.now(),
            chapter,
            html: '<p>Replacement</p>',
        }));
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(200, `
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
            `, chapter.editUrl))
            .mockResolvedValueOnce(response(200, `
                <html>
                    <body class="logged-in">
                        <div id="chapters">
                            <div id="chapter-123456789"><div class="userstuff">Replacement</div></div>
                        </div>
                    </body>
                </html>
            `, chapter.readerUrl));
        vi.stubGlobal('fetch', fetchMock);

        await Ao3Bridge._processPendingRequest();

        const result = parseAo3BridgeResult(storage.get(AO3_BRIDGE_RESULT_KEY));
        expect(result?.ok).toBe(true);
        const postInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
        expect(postInit.method).toBe('POST');
        expect(String(postInit.body)).toContain('chapter%5Bcontent%5D=%3Cp%3EReplacement%3C%2Fp%3E');
        expect(postInit.credentials).toBe('same-origin');
    });

    it('waits for the user when AO3 is not logged in yet', async () => {
        document.body.className = '';
        storage.set(AO3_BRIDGE_REQUEST_KEY, serializeAo3BridgeRequest({
            id: 'load-logged-out',
            kind: 'loadChapterIndex',
            createdAt: Date.now(),
            workUrl: 'https://archiveofourown.org/works/77945481',
        }));
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        Ao3Bridge._injectPanel();
        await Ao3Bridge._processPendingRequest();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(storage.has(AO3_BRIDGE_RESULT_KEY)).toBe(false);
        expect(document.getElementById('ffne-ao3-bridge-panel')?.textContent).toContain('Sign in to AO3');
    });

    it('returns a Cloudflare failure result from challenged fetch responses', async () => {
        storage.set(AO3_BRIDGE_REQUEST_KEY, serializeAo3BridgeRequest({
            id: 'cf-1',
            kind: 'loadChapterIndex',
            createdAt: Date.now(),
            workUrl: 'https://archiveofourown.org/works/77945481',
        }));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(403, `
            <html>
                <body>
                    <div id="cf-browser-verification">Checking your browser</div>
                    <p>DDoS protection by Cloudflare</p>
                </body>
            </html>
        `, 'https://archiveofourown.org/works/77945481/navigate')));

        await Ao3Bridge._processPendingRequest();

        const result = parseAo3BridgeResult(storage.get(AO3_BRIDGE_RESULT_KEY));
        expect(result?.ok).toBe(false);
        expect(result?.reason).toContain('Cloudflare');
    });
});
