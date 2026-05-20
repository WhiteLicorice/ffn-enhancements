import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageType } from '../background/message-types';
import { SettingsMenu } from '../modules/SettingsMenu';
import { SettingsPage } from '../modules/SettingsPage';
import './__mocks__/chrome';

vi.mock('../modules/SettingsPage', () => ({
    SettingsPage: { openModal: vi.fn() },
}));

interface OnMessageListener {
    (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
    ): boolean | void;
}

const listenerHolder: { current: OnMessageListener | undefined } = { current: undefined };

const originalAddListener = chrome.runtime.onMessage.addListener;
chrome.runtime.onMessage.addListener = function (cb: OnMessageListener): void {
    listenerHolder.current = cb;
    return originalAddListener.call(chrome.runtime.onMessage, cb as never);
};

describe('SettingsMenu chrome.runtime.onMessage listener', () => {
    beforeAll(() => {
        SettingsMenu.prime();
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens the modal when OPEN_SETTINGS message arrives from the service worker', () => {
        expect(listenerHolder.current).toBeTypeOf('function');
        const sendResponse = vi.fn();
        listenerHolder.current?.(
            { type: MessageType.OPEN_SETTINGS },
            { id: 'sw' } as chrome.runtime.MessageSender,
            sendResponse,
        );

        expect(SettingsPage.openModal).toHaveBeenCalledTimes(1);
        // The listener acknowledges receipt so the SW's sendMessage Promise
        // resolves with a truthy value rather than rejecting on closed port.
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it('ignores messages with a different type', () => {
        const sendResponse = vi.fn();
        listenerHolder.current?.(
            { type: 'SOMETHING_ELSE' },
            { id: 'sw' } as chrome.runtime.MessageSender,
            sendResponse,
        );

        expect(SettingsPage.openModal).not.toHaveBeenCalled();
        // No response sent — caller may receive the standard "port closed" error.
        expect(sendResponse).not.toHaveBeenCalled();
    });
});
