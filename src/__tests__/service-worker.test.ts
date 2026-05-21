import { beforeEach, describe, expect, it, vi } from 'vitest';

import './__mocks__/browser';
import { mockChromeRuntime, mockChromeTabs } from './__mocks__/browser';

describe('service worker', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockChromeRuntime._reset();
        mockChromeTabs._reset();
        await import('../background/service-worker');
    });

    it('proxies OPEN_TAB to browser.tabs.create', async () => {
        const browserApi = globalThis.browser as typeof globalThis.browser;

        const response = await browserApi.runtime.sendMessage({
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
        const browserApi = globalThis.browser as typeof globalThis.browser;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
        }));

        try {
            const response = await browserApi.runtime.sendMessage({
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
        const browserApi = globalThis.browser as typeof globalThis.browser;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
            new Uint8Array([1, 2, 3]),
            { status: 200 },
        ));

        try {
            const response = await browserApi.runtime.sendMessage({
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
});
