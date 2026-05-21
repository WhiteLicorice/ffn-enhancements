import { beforeEach, describe, expect, it } from 'vitest';

import '../__mocks__/browser';
import {
    mockBrowserApi,
    mockChromePermissions,
    mockChromeRuntime,
    mockChromeStorage,
    mockChromeTabs,
} from '../__mocks__/browser';
import { extensionApi } from '../../platform/extensionApi';

describe('extensionApi', () => {
    beforeEach(() => {
        mockBrowserApi.install();
        mockChromeRuntime._reset();
        mockChromePermissions._reset();
        mockChromeTabs._reset();
        mockChromeStorage._reset();
    });

    it('prefers the browser promise namespace when available', async () => {
        const browserApi = (globalThis as typeof globalThis & {
            browser: { runtime: { onMessage: { addListener(listener: (message: unknown) => unknown): void } } };
        }).browser;

        browserApi.runtime.onMessage.addListener((message) => ({ ok: true, echoed: message }));

        await extensionApi.storage.local.set({ ffne_theme: 'dark' });
        const stored = await extensionApi.storage.local.get(null);
        const hasPermissionBefore = await extensionApi.permissions.contains({ origins: ['*://fichub.net/*'] });
        const requested = await extensionApi.permissions.request({ origins: ['*://fichub.net/*'] });
        const createdTab = await extensionApi.tabs.create({ url: 'https://example.com/', active: false });
        const response = await extensionApi.runtime.sendMessage<{ ok: boolean; echoed: unknown }>({ type: 'PING' });

        expect(stored.ffne_theme).toBe('dark');
        expect(hasPermissionBefore).toBe(false);
        expect(requested).toBe(true);
        expect(createdTab).toMatchObject({ url: 'https://example.com/', active: false });
        expect(response).toEqual({ ok: true, echoed: { type: 'PING' } });
    });

    it('falls back to callback-based chrome APIs when browser is unavailable', async () => {
        mockBrowserApi.uninstall();

        await extensionApi.storage.local.set({ ffne_theme: 'sepia' });
        const stored = await extensionApi.storage.local.get(null);
        const hasPermissionBefore = await extensionApi.permissions.contains({ origins: ['*://fichub.net/*'] });
        const requested = await extensionApi.permissions.request({ origins: ['*://fichub.net/*'] });
        const createdTab = await extensionApi.tabs.create({ url: 'https://example.com/fallback', active: true });

        expect(stored.ffne_theme).toBe('sepia');
        expect(hasPermissionBefore).toBe(false);
        expect(requested).toBe(true);
        expect(createdTab).toMatchObject({ url: 'https://example.com/fallback', active: true });
    });

    it('rejects chrome callback responses when runtime.lastError is set', async () => {
        mockBrowserApi.uninstall();

        const chromeApi = (globalThis as typeof globalThis & { chrome: typeof chrome }).chrome;
        const originalSendMessage = chromeApi.runtime.sendMessage.bind(chromeApi.runtime);

        const failingSendMessage = ((_message: unknown, callback?: (response: unknown) => void) => {
            chromeApi.runtime.lastError = { message: 'Permission denied' };
            callback?.(undefined);
            chromeApi.runtime.lastError = undefined;
        }) as typeof chrome.runtime.sendMessage;

        chromeApi.runtime.sendMessage = failingSendMessage;

        try {
            await expect(extensionApi.runtime.sendMessage({ type: 'FAIL' }))
                .rejects
                .toThrow('Permission denied');
        } finally {
            chromeApi.runtime.sendMessage = originalSendMessage;
        }
    });
});
