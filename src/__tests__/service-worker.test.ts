import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '../background/message-types';
import { mockChromeAction, mockChromeTabs } from './__mocks__/chrome';

/**
 * ExecuteScript call shape used in expectations.
 * `func` must be a Function (not specifically triggerSettingsModalViaPostMessage
 * since the bundled reference differs from the source reference).
 */
function expectFuncCall(tabId: number) {
    return { target: { tabId }, func: expect.any(Function) as unknown as () => void };
}

function expectFilesCall(tabId: number) {
    return { target: { tabId }, files: ['content/main.js'] };
}

function expectSendMessageCall(tabId: number) {
    return { tabId, message: { type: MessageType.OPEN_SETTINGS } };
}

describe('service worker action click', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockChromeAction._reset();
        mockChromeTabs._reset();
        await import('../background/service-worker');
    });

    it('registers the action.onClicked listener on module load', () => {
        // Regression: Firefox event pages with type:'module' lose listener
        // persistence. The built service-worker.js must not require ES-module
        // loading — listeners must register synchronously at top level.
        expect(mockChromeAction.listenerCount).toBe(1);
    });

    it('dispatches open-settings via executeScript func (postMessage) on supported tabs', async () => {
        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        // Primary path: scripting.executeScript with func that calls window.postMessage.
        // This bypasses chrome.tabs.sendMessage and works in both Chrome SW and Firefox event pages.
        expect(mockChromeTabs.state.executeScriptCalls).toEqual([
            expectFuncCall(7),
        ]);
        expect(mockChromeTabs.state.sendMessageCalls).toHaveLength(0);
        expect(mockChromeTabs.state.createCalls).toHaveLength(0);
    });

    it('injects content/main.js and retries postMessage when the first executeScript fails', async () => {
        // Reject the first executeScript call (func-based postMessage),
        // then allow subsequent calls (files-based injection + func retry).
        mockChromeTabs.state.executeScriptRejectTabIds.add(7);

        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        // Step 1: func-based executeScript rejects (tab in reject set).
        // Step 2: files-based injection (injectContentScript) also rejects
        //         because mock shares the same reject set.
        // Step 3: sendMessage fallback is attempted.
        expect(mockChromeTabs.state.sendMessageCalls).toEqual([
            expectSendMessageCall(7),
        ]);
        expect(mockChromeTabs.state.createCalls).toHaveLength(0);
    });

    it('injects content script then retries postMessage when func-based dispatch fails', async () => {
        // Reject only the FIRST executeScript call (func), allow the rest.
        mockChromeTabs.state.executeScriptRejectCount.set(7, 1);

        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        // Step 1: func-based postMessage dispatch rejects (count 1 → 0).
        // Step 2: files-based injection succeeds (count is 0).
        // Step 3: func-based postMessage retry succeeds (count is 0).
        expect(mockChromeTabs.state.executeScriptCalls).toEqual([
            expectFuncCall(7),       // step 1: primary dispatch (rejected)
            expectFilesCall(7),      // step 2: inject content/main.js
            expectFuncCall(7),       // step 3: retry dispatch (succeeds)
        ]);
        // sendMessage is only called if all executeScript attempts fail.
        expect(mockChromeTabs.state.sendMessageCalls).toHaveLength(0);
        expect(mockChromeTabs.state.createCalls).toHaveLength(0);
    });

    it('falls back to sendMessage when all executeScript attempts fail', async () => {
        // Reject both func-based attempts (2 calls), leaving files injection to also fail.
        mockChromeTabs.state.executeScriptRejectTabIds.add(7);

        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        // Step 1: func rejects. Step 2: files rejects. Step 4: sendMessage fallback.
        expect(mockChromeTabs.state.sendMessageCalls).toEqual([
            expectSendMessageCall(7),
        ]);
    });

    it('opens FFN and dispatches postMessage when the current tab is unsupported', async () => {
        await mockChromeAction.click({ id: 7, url: 'https://example.com/' } as chrome.tabs.Tab);

        // Tab is unsupported → opens a new FFN tab.
        expect(mockChromeTabs.state.createCalls).toEqual([
            { url: 'https://www.fanfiction.net/', active: true },
        ]);

        // Simulate the new tab finishing loading.
        mockChromeTabs.triggerUpdated(100, { status: 'complete' });
        await Promise.resolve();

        // On the newly loaded tab, primary dispatch via executeScript func is used.
        expect(mockChromeTabs.state.executeScriptCalls).toEqual([
            expectFuncCall(100),
        ]);
        expect(mockChromeTabs.state.sendMessageCalls).toHaveLength(0);
    });
});
