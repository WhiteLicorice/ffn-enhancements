import { beforeEach, describe, expect, it, vi } from 'vitest';

import './__mocks__/browser';
import { mockBrowserApi, mockChromeRuntime, mockChromeTabs } from './__mocks__/browser';

function getChromeApi(): { runtime: { sendMessage(message: unknown): Promise<unknown> } } {
    return (globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } }).chrome;
}

describe('service worker', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockChromeRuntime._reset();
        mockChromeTabs._reset();
        await import('../background/service-worker');
    });

    it('proxies OPEN_TAB to browser.tabs.create', async () => {
        const chromeApi = getChromeApi();

        const response = await chromeApi.runtime.sendMessage({
            type: 'OPEN_TAB',
            url: 'https://archiveofourown.org/works/1',
            active: false,
        });

        expect(response).toEqual({ ok: true });
        expect(mockChromeTabs.state.createCalls).toEqual([
            { url: 'https://archiveofourown.org/works/1', active: false },
        ]);
    });

    it('returns text responses for CROSS_ORIGIN_FETCH', async () => {
        const chromeApi = getChromeApi();
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
        }));

        try {
            const response = await chromeApi.runtime.sendMessage({
                type: 'CROSS_ORIGIN_FETCH',
                url: 'https://example.com/',
                method: 'GET',
                responseType: 'text',
            });

            expect(fetchSpy).toHaveBeenCalled();
            expect(response).toMatchObject({ ok: true, status: 200, data: 'ok' });
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('returns base64 strings for blob responses', async () => {
        const chromeApi = getChromeApi();
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
            new Uint8Array([1, 2, 3]),
            { status: 200, headers: { 'Content-Type': 'application/octet-stream' } },
        ));

        try {
            const response = await chromeApi.runtime.sendMessage({
                type: 'CROSS_ORIGIN_FETCH',
                url: 'https://example.com/file',
                method: 'GET',
                responseType: 'blob',
            });

            expect(response).toMatchObject({
                ok: true,
                status: 200,
                dataBase64: 'AQID',
                mimeType: 'application/octet-stream',
            });
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('fetches FicHub URLs through the background context', async () => {
        const chromeApi = getChromeApi();
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        try {
            await chromeApi.runtime.sendMessage({
                type: 'CROSS_ORIGIN_FETCH',
                url: 'https://fichub.net/api/v0/meta?q=test',
                method: 'GET',
                responseType: 'text',
            });

            expect(fetchSpy).toHaveBeenCalledWith(
                'https://fichub.net/api/v0/meta?q=test',
                expect.objectContaining({ method: 'GET', credentials: 'include' }),
            );
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('returns permission-like fetch failures to callers', async () => {
        const chromeApi = getChromeApi();
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('Access to fetch at "https://fichub.net" is not allowed'),
        );

        try {
            const response = await chromeApi.runtime.sendMessage({
                type: 'CROSS_ORIGIN_FETCH',
                url: 'https://fichub.net/file.epub',
                method: 'GET',
                responseType: 'blob',
            });

            expect(response).toMatchObject({
                ok: false,
                status: 0,
                finalUrl: 'https://fichub.net/file.epub',
                error: 'Access to fetch at "https://fichub.net" is not allowed',
            });
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('handles chrome callbacks when browser is unavailable', async () => {
        vi.resetModules();
        mockChromeRuntime._reset();
        mockChromeTabs._reset();
        mockBrowserApi.uninstall();
        await import('../background/service-worker');

        const response = await getChromeApi().runtime.sendMessage({
            type: 'OPEN_TAB',
            url: 'https://example.com/fallback',
        });

        expect(response).toEqual({ ok: true });
        expect(mockChromeTabs.state.createCalls).toEqual([
            { url: 'https://example.com/fallback', active: true },
        ]);
    });
});
