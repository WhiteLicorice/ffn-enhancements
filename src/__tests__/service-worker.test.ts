import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '../background/message-types';
import { mockChromeAction, mockChromeTabs } from './__mocks__/chrome';

describe('service worker action click', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockChromeAction._reset();
        mockChromeTabs._reset();
        await import('../background/service-worker');
    });

    it('opens settings on the active tab when a content script is listening', async () => {
        await mockChromeAction.click({ id: 7, url: 'https://www.fanfiction.net/s/1/1/' } as chrome.tabs.Tab);

        expect(mockChromeTabs.state.sendMessageCalls).toEqual([
            { tabId: 7, message: { type: MessageType.OPEN_SETTINGS } },
        ]);
        expect(mockChromeTabs.state.createCalls).toHaveLength(0);
    });

    it('opens FFN and then opens settings when the current tab cannot receive messages', async () => {
        mockChromeTabs.state.sendMessageRejectTabIds.add(7);

        await mockChromeAction.click({ id: 7, url: 'https://example.com/' } as chrome.tabs.Tab);

        expect(mockChromeTabs.state.createCalls).toEqual([
            { url: 'https://www.fanfiction.net/', active: true },
        ]);

        mockChromeTabs.triggerUpdated(100, { status: 'complete' });
        await Promise.resolve();

        expect(mockChromeTabs.state.sendMessageCalls).toEqual([
            { tabId: 7, message: { type: MessageType.OPEN_SETTINGS } },
            { tabId: 100, message: { type: MessageType.OPEN_SETTINGS } },
        ]);
    });
});
