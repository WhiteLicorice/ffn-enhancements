import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CONTENT_SCRIPT_CSS_FILES,
    CONTENT_SCRIPT_JS_FILES,
    CONTENT_SCRIPT_TAB_PATTERNS,
    REQUESTED_HOST_PATTERNS,
} from '../background/contentScriptManifest';
import { MessageType } from '../background/message-types';
import {
    mockChromeAction,
    mockChromePermissions,
    mockChromeRuntimeOnInstalled,
    mockChromeScripting,
    mockChromeTabs,
} from './__mocks__/chrome';

function expectCssCall(tabId: number) {
    return { target: { tabId }, files: [...CONTENT_SCRIPT_CSS_FILES] };
}

function expectFilesCall(tabId: number, file: string) {
    return { target: { tabId }, files: [file] };
}

function expectSendMessageCall(tabId: number) {
    return { tabId, message: { type: MessageType.OPEN_SETTINGS } };
}

async function flushAsyncWork(iterations = 5): Promise<void> {
    for (let i = 0; i < iterations; i += 1) {
        await Promise.resolve();
    }
}

describe('service worker action click', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockChromeAction._reset();
        mockChromePermissions._reset();
        mockChromeRuntimeOnInstalled._reset();
        mockChromeScripting._reset();
        mockChromeTabs._reset();
        mockChromePermissions.grant([...REQUESTED_HOST_PATTERNS]);
        await import('../background/service-worker');
    });

    it('registers via chrome.action.onClicked when only chrome is available', () => {
        // Regression: Firefox event pages with type:'module' lose listener
        // persistence. The built service-worker.js must not require ES-module
        // loading — listeners must register synchronously at top level.
        expect(mockChromeAction.listenerCount).toBe(1);
    });

    it('registers via browser.action.onClicked when browser global is present', async () => {
        const browserActionListeners: Array<(tab: chrome.tabs.Tab) => void> = [];
        const browserGlobal = globalThis as typeof globalThis & { browser?: unknown };
        browserGlobal.browser = {
            action: {
                onClicked: {
                    addListener: (cb: (tab: chrome.tabs.Tab) => void) => browserActionListeners.push(cb),
                    removeListener: () => undefined,
                },
            },
        };

        try {
            vi.resetModules();
            mockChromeAction._reset();
            await import('../background/service-worker');

            expect(browserActionListeners).toHaveLength(1);
            expect(mockChromeAction.listenerCount).toBe(0);
        } finally {
            delete browserGlobal.browser;
        }
    });

    it('dispatches open-settings via chrome.tabs.sendMessage as primary path', async () => {
        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        // Primary path: chrome.tabs.sendMessage. When a content script with the
        // OPEN_SETTINGS listener is loaded (Chrome default; Firefox with host
        // permission granted), this resolves and we skip the inject + retry
        // fallback entirely.
        expect(mockChromeTabs.state.sendMessageCalls).toEqual([
            expectSendMessageCall(7),
        ]);
        expect(mockChromePermissions.state.requestCalls).toHaveLength(0);
        expect(mockChromeScripting.insertCSSCalls).toHaveLength(0);
        expect(mockChromeTabs.state.executeScriptCalls).toHaveLength(0);
        expect(mockChromeTabs.state.createCalls).toHaveLength(0);
    });

    it('requests host permissions on action click when missing', async () => {
        mockChromePermissions.state.grantedOrigins.clear();

        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        expect(mockChromePermissions.state.requestCalls).toEqual([
            { origins: [...REQUESTED_HOST_PATTERNS] },
        ]);
    });

    it('skips permission request when already granted', async () => {
        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        expect(mockChromePermissions.state.requestCalls).toHaveLength(0);
    });

    it('falls back to activeTab inject when user denies host permissions', async () => {
        mockChromePermissions.state.grantedOrigins.clear();
        mockChromePermissions.state.requestResult = false;
        // Pre-arm: reject sendMessage calls for tab 7 (no content script loaded).
        mockChromeTabs.state.sendMessageRejectTabIds.add(7);

        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        expect(mockChromePermissions.state.requestCalls).toEqual([
            { origins: [...REQUESTED_HOST_PATTERNS] },
        ]);
        expect(mockChromeScripting.insertCSSCalls).toEqual([
            expectCssCall(7),
        ]);
        expect(mockChromeTabs.state.executeScriptCalls).toEqual([
            expectFilesCall(7, CONTENT_SCRIPT_JS_FILES[0]),
            expectFilesCall(7, CONTENT_SCRIPT_JS_FILES[1]),
        ]);
    });

    it('injects full content scripts then retries sendMessage when first sendMessage fails', async () => {
        mockChromeTabs.state.sendMessageRejectTabIds.add(7);

        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        expect(mockChromeTabs.state.sendMessageCalls).toEqual([
            expectSendMessageCall(7), // step 1: primary, rejected
            expectSendMessageCall(7), // step 3: retry after inject, succeeds
        ]);
        expect(mockChromeScripting.insertCSSCalls).toEqual([
            expectCssCall(7),
        ]);
        expect(mockChromeTabs.state.executeScriptCalls).toEqual([
            expectFilesCall(7, CONTENT_SCRIPT_JS_FILES[0]),
            expectFilesCall(7, CONTENT_SCRIPT_JS_FILES[1]),
        ]);
        expect(mockChromeTabs.state.createCalls).toHaveLength(0);
    });

    it('returns early when injection fails after sendMessage failure', async () => {
        // No listener AND injection fails (e.g., page not injectable, no activeTab grant).
        mockChromeTabs.state.sendMessageRejectTabIds.add(7);
        mockChromeTabs.state.executeScriptRejectTabIds.add(7);

        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        // Step 1: sendMessage attempted, rejected.
        // Step 2: injectContentScript attempted, rejected. No step 3.
        expect(mockChromeTabs.state.sendMessageCalls).toEqual([
            expectSendMessageCall(7),
        ]);
        expect(mockChromeScripting.insertCSSCalls).toEqual([
            expectCssCall(7),
        ]);
        expect(mockChromeTabs.state.executeScriptCalls).toEqual([
            expectFilesCall(7, CONTENT_SCRIPT_JS_FILES[0]),
        ]);
        expect(mockChromeTabs.state.createCalls).toHaveLength(0);
    });

    it('onPermissionsAdded injects into all matching tabs', async () => {
        mockChromeTabs.state.queryResponseTabs = [
            { id: 11, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab,
            { id: 12, url: 'https://fanfiction.net/s/1/1/' } as chrome.tabs.Tab,
            { id: 13, url: 'https://archiveofourown.org/works/1' } as chrome.tabs.Tab,
        ];

        mockChromePermissions.revoke([...REQUESTED_HOST_PATTERNS]);
        mockChromePermissions.grant([...REQUESTED_HOST_PATTERNS]);
        await flushAsyncWork();

        expect(mockChromeTabs.state.queryCalls).toContainEqual({ url: [...CONTENT_SCRIPT_TAB_PATTERNS] });
        expect(mockChromeScripting.insertCSSCalls).toHaveLength(3);
        expect(mockChromeTabs.state.executeScriptCalls).toHaveLength(6);
        const executeScriptCallsByTab = new Map(
            mockChromeTabs.state.executeScriptCalls.map((call) => [call.target.tabId, [] as string[]]),
        );
        for (const call of mockChromeTabs.state.executeScriptCalls) {
            executeScriptCallsByTab.get(call.target.tabId)?.push(...(call.files ?? []));
        }
        expect(executeScriptCallsByTab).toEqual(new Map([
            [11, [...CONTENT_SCRIPT_JS_FILES]],
            [12, [...CONTENT_SCRIPT_JS_FILES]],
            [13, [...CONTENT_SCRIPT_JS_FILES]],
        ]));
    });

    it('runtime.onInstalled triggers probe without throwing', async () => {
        mockChromePermissions.state.grantedOrigins.clear();
        mockChromePermissions.state.requestResult = false;

        expect(() => {
            mockChromeRuntimeOnInstalled.fire({ reason: 'install' } as chrome.runtime.InstalledDetails);
        }).not.toThrow();
        await flushAsyncWork();

        expect(mockChromePermissions.state.requestCalls).toEqual([
            { origins: [...REQUESTED_HOST_PATTERNS] },
        ]);
    });

    it('onPermissionsRemoved logs warning without throwing', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        try {
            expect(() => {
                mockChromePermissions.revoke([...REQUESTED_HOST_PATTERNS]);
            }).not.toThrow();

            expect(warnSpy).toHaveBeenCalledWith(
                'FFN-Enhancements: host permissions revoked. Features unavailable on new tab loads until re-granted.',
                [...REQUESTED_HOST_PATTERNS],
            );
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('opens FFN and dispatches via sendMessage when the current tab is unsupported', async () => {
        await mockChromeAction.click({ id: 7, url: 'https://example.com/' } as chrome.tabs.Tab);

        // Tab is unsupported → opens a new FFN tab.
        expect(mockChromeTabs.state.createCalls).toEqual([
            { url: 'https://www.fanfiction.net/', active: true },
        ]);

        // Simulate the new tab finishing loading.
        mockChromeTabs.triggerUpdated(100, { status: 'complete' });
        await Promise.resolve();

        // On the newly loaded tab, sendMessage is the primary dispatch.
        expect(mockChromeTabs.state.sendMessageCalls).toEqual([
            expectSendMessageCall(100),
        ]);
        expect(mockChromeTabs.state.executeScriptCalls).toHaveLength(0);
    });
});
