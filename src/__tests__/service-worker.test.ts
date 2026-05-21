import { beforeEach, describe, expect, it, vi } from 'vitest';

import './__mocks__/browser';
import { mockBrowserApi, mockChromePermissions, mockChromeRuntime, mockChromeTabs } from './__mocks__/browser';

function getChromeApi(): { runtime: { sendMessage(message: unknown): Promise<unknown> } } {
    return (globalThis as unknown as { chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } } }).chrome;
}

describe('service worker', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockChromeRuntime._reset();
        mockChromeTabs._reset();
        mockChromePermissions._reset();
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

    it('returns byte arrays for blob responses', async () => {
        const chromeApi = getChromeApi();
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
            new Uint8Array([1, 2, 3]),
            { status: 200 },
        ));

        try {
            const response = await chromeApi.runtime.sendMessage({
                type: 'CROSS_ORIGIN_FETCH',
                url: 'https://example.com/file',
                method: 'GET',
                responseType: 'blob',
            });

            expect(response).toMatchObject({ ok: true, status: 200, data: [1, 2, 3] });
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it('requests FicHub optional host permission in the background context', async () => {
        const chromeApi = getChromeApi();

        const response = await chromeApi.runtime.sendMessage({
            type: 'ENSURE_FICHUB_PERMISSION',
        });

        expect(response).toEqual({ ok: true, granted: true });
        expect(mockChromePermissions.state.requestCalls).toEqual([
            { origins: ['*://fichub.net/*'] },
        ]);
    });

    it('does not re-request FicHub permission when it is already granted', async () => {
        const chromeApi = getChromeApi();
        mockChromePermissions.state.grantedOrigins.add('*://fichub.net/*');

        const response = await chromeApi.runtime.sendMessage({
            type: 'ENSURE_FICHUB_PERMISSION',
        });

        expect(response).toEqual({ ok: true, granted: true });
        expect(mockChromePermissions.state.requestCalls).toEqual([]);
    });

    it('handles FicHub permission through chrome callbacks when browser is unavailable', async () => {
        vi.resetModules();
        mockChromeRuntime._reset();
        mockChromeTabs._reset();
        mockChromePermissions._reset();
        mockBrowserApi.uninstall();
        await import('../background/service-worker');

        const response = await getChromeApi().runtime.sendMessage({
            type: 'ENSURE_FICHUB_PERMISSION',
        });

        expect(response).toEqual({ ok: true, granted: true });
        expect(mockChromePermissions.state.requestCalls).toEqual([
            { origins: ['*://fichub.net/*'] },
        ]);
    });
});
