import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GM_deleteValue, GM_getValue, GM_openInTab, GM_setValue } from '$';
import { Ao3BridgeClient } from '../services/Ao3BridgeClient';
import type { IAo3Chapter } from '../interfaces/IAo3Migration';
import {
    AO3_BRIDGE_HEARTBEAT_KEY,
    AO3_BRIDGE_REUSE_HEARTBEAT_MS,
    AO3_BRIDGE_REQUEST_KEY,
    AO3_BRIDGE_RESULT_KEY,
    parseAo3BridgeRequest,
    parseAo3BridgeResult,
    serializeAo3BridgeHeartbeat,
    serializeAo3BridgeRequest,
    serializeAo3BridgeResult,
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

describe('Ao3BridgeClient', () => {
    const storage = new Map<string, unknown>();

    beforeEach(() => {
        vi.useFakeTimers();
        storage.clear();
        vi.mocked(GM_getValue).mockImplementation((key: string) => storage.get(key));
        vi.mocked(GM_setValue).mockImplementation((key: string, value: unknown) => {
            storage.set(key, value);
        });
        vi.mocked(GM_deleteValue).mockImplementation((key: string) => {
            storage.delete(key);
        });
        vi.mocked(GM_openInTab).mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('serializes and parses bridge requests and results', () => {
        const request = {
            id: 'req-1',
            kind: 'updateChapterContent' as const,
            createdAt: 100,
            chapter: makeChapter(),
            html: '<p>Replacement</p>',
        };
        const result = {
            id: 'req-1',
            kind: 'updateChapterContent' as const,
            ok: true,
            finalUrl: request.chapter.readerUrl,
        };

        expect(parseAo3BridgeRequest(serializeAo3BridgeRequest(request))).toEqual(request);
        expect(parseAo3BridgeResult(serializeAo3BridgeResult(result))).toEqual(result);
        expect(parseAo3BridgeRequest('{bad json')).toBeNull();
        expect(parseAo3BridgeResult(JSON.stringify({ id: 'x', ok: true }))).toBeNull();
    });

    it('rejects bridge update requests with mismatched chapter URLs', () => {
        expect(parseAo3BridgeRequest(JSON.stringify({
            id: 'req-2',
            kind: 'updateChapterContent',
            createdAt: 100,
            chapter: {
                ...makeChapter(),
                readerUrl: 'https://archiveofourown.org/works/77945481/chapters/999999999',
            },
            html: '<p>Replacement</p>',
        }))).toBeNull();
    });

    it('opens AO3 in the foreground, waits for the matching result, and cleans storage', async () => {
        const promise = Ao3BridgeClient.fetchChapterIndex(
            'https://archiveofourown.org/works/77945481/chapters/1',
            { timeoutMs: 1000, pollIntervalMs: 50 },
        );

        expect(GM_openInTab).toHaveBeenCalledWith(
            'https://archiveofourown.org/works/77945481',
            { active: true, insert: true },
        );

        const request = parseAo3BridgeRequest(storage.get(AO3_BRIDGE_REQUEST_KEY));
        expect(request?.kind).toBe('loadChapterIndex');

        storage.set(AO3_BRIDGE_RESULT_KEY, serializeAo3BridgeResult({
            id: 'wrong-id',
            kind: 'loadChapterIndex',
            ok: false,
            reason: 'Wrong result',
        }));
        await vi.advanceTimersByTimeAsync(50);

        storage.set(AO3_BRIDGE_RESULT_KEY, serializeAo3BridgeResult({
            id: request?.id || '',
            kind: 'loadChapterIndex',
            ok: true,
            chapters: [makeChapter()],
        }));
        await vi.advanceTimersByTimeAsync(50);

        await expect(promise).resolves.toEqual({ ok: true, chapters: [makeChapter()] });
        expect(storage.has(AO3_BRIDGE_REQUEST_KEY)).toBe(false);
        expect(storage.has(AO3_BRIDGE_RESULT_KEY)).toBe(false);
    });

    it('times out when no AO3 bridge result arrives', async () => {
        const promise = Ao3BridgeClient.updateChapterContent(
            makeChapter(),
            '<p>Replacement</p>',
            { timeoutMs: 500, pollIntervalMs: 100 },
        );

        await vi.advanceTimersByTimeAsync(500);

        const result = await promise;
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('AO3 bridge did not respond');
        expect(storage.has(AO3_BRIDGE_REQUEST_KEY)).toBe(false);
    });

    it('opens AO3 immediately when a lingering heartbeat is too old to reuse', async () => {
        storage.set(AO3_BRIDGE_HEARTBEAT_KEY, serializeAo3BridgeHeartbeat({
            at: Date.now() - AO3_BRIDGE_REUSE_HEARTBEAT_MS - 1,
            url: 'https://archiveofourown.org/',
            loggedIn: true,
        }));

        const promise = Ao3BridgeClient.fetchChapterIndex(
            'https://archiveofourown.org/works/77945481',
            { timeoutMs: 1000, pollIntervalMs: 50 },
        );

        expect(GM_openInTab).toHaveBeenCalledWith(
            'https://archiveofourown.org/works/77945481',
            { active: true, insert: true },
        );

        const request = parseAo3BridgeRequest(storage.get(AO3_BRIDGE_REQUEST_KEY));
        storage.set(AO3_BRIDGE_RESULT_KEY, serializeAo3BridgeResult({
            id: request?.id || '',
            kind: 'loadChapterIndex',
            ok: true,
            chapters: [makeChapter()],
        }));
        await vi.advanceTimersByTimeAsync(50);

        await expect(promise).resolves.toEqual({ ok: true, chapters: [makeChapter()] });
    });

    it('opens AO3 on the first request when a fresh-looking heartbeat does not advance', async () => {
        storage.set(AO3_BRIDGE_HEARTBEAT_KEY, serializeAo3BridgeHeartbeat({
            at: Date.now(),
            url: 'https://archiveofourown.org/',
            loggedIn: true,
        }));

        const promise = Ao3BridgeClient.fetchChapterIndex(
            'https://archiveofourown.org/works/77945481',
            { timeoutMs: 60000, pollIntervalMs: 250 },
        );

        expect(GM_openInTab).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(AO3_BRIDGE_REUSE_HEARTBEAT_MS + 250);

        expect(GM_openInTab).toHaveBeenCalledWith(
            'https://archiveofourown.org/works/77945481',
            { active: true, insert: true },
        );

        const request = parseAo3BridgeRequest(storage.get(AO3_BRIDGE_REQUEST_KEY));
        storage.set(AO3_BRIDGE_RESULT_KEY, serializeAo3BridgeResult({
            id: request?.id || '',
            kind: 'loadChapterIndex',
            ok: true,
            chapters: [makeChapter()],
        }));
        await vi.advanceTimersByTimeAsync(250);

        await expect(promise).resolves.toEqual({ ok: true, chapters: [makeChapter()] });
    });
});
