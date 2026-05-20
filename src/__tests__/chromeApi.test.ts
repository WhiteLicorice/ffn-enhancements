import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeSendMessage, storageGet, storageRemove, storageSet, tabsQuery, tabsSendMessage } from '../platform/chromeApi';

const originalChrome = globalThis.chrome;

describe('chromeApi compatibility wrappers', () => {
    beforeEach(() => {
        const runtime = {
            lastError: undefined as chrome.runtime.LastError | undefined,
            sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
                callback({ ok: true });
            }),
        };

        (globalThis as unknown as { chrome: unknown }).chrome = {
            runtime,
            storage: {
                local: {
                    get: vi.fn((_keys: unknown, callback: (items: Record<string, unknown>) => void) => {
                        callback({ ffne_theme: 'dark' });
                    }),
                    set: vi.fn((_items: Record<string, unknown>, callback: () => void) => {
                        callback();
                    }),
                    remove: vi.fn((_keys: string | string[], callback: () => void) => {
                        callback();
                    }),
                },
            },
            tabs: {
                query: vi.fn((_query: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
                    callback([{ id: 1, url: 'https://www.fanfiction.net/' } as chrome.tabs.Tab]);
                }),
                sendMessage: vi.fn((_tabId: number, _message: unknown, callback: (response: unknown) => void) => {
                    callback({ ok: true });
                }),
            },
        };
    });

    afterEach(() => {
        (globalThis as unknown as { chrome: typeof chrome }).chrome = originalChrome;
        vi.restoreAllMocks();
    });

    it('resolves callback-style chrome APIs', async () => {
        await expect(runtimeSendMessage({ type: 'PING' })).resolves.toEqual({ ok: true });
        await expect(tabsQuery({ active: true })).resolves.toEqual([{ id: 1, url: 'https://www.fanfiction.net/' }]);
        await expect(tabsSendMessage(1, { type: 'PING' })).resolves.toEqual({ ok: true });
        await expect(storageGet(null)).resolves.toEqual({ ffne_theme: 'dark' });
        await expect(storageSet({ ffne_theme: 'dark' })).resolves.toBeUndefined();
        await expect(storageRemove('ffne_theme')).resolves.toBeUndefined();
    });

    it('rejects callback-style chrome APIs when runtime.lastError is set', async () => {
        const chromeMock = chrome as unknown as {
            runtime: {
                lastError?: chrome.runtime.LastError;
                sendMessage: ReturnType<typeof vi.fn>;
            };
        };

        chromeMock.runtime.sendMessage.mockImplementation((_message: unknown, callback: (response: unknown) => void) => {
            chromeMock.runtime.lastError = { message: 'Receiving end does not exist.' };
            callback(undefined);
            chromeMock.runtime.lastError = undefined;
        });

        await expect(runtimeSendMessage({ type: 'PING' })).rejects.toThrow('Receiving end does not exist.');
    });
});
