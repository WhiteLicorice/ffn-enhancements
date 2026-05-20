// Service worker entry point for FFN Enhancements MV3 extension.
// Handles cross-origin fetch proxying and tab management on behalf of content scripts.

import { MessageType } from './message-types';
import type { BackgroundMessage, CrossOriginFetchMessage, CrossOriginFetchResponse } from './message-types';

console.log('FFN Enhancements service worker loaded.');

chrome.runtime.onMessage.addListener(
    (message: BackgroundMessage, sender, sendResponse: (response: unknown) => void) => {
        switch (message.type) {
            case MessageType.CROSS_ORIGIN_FETCH:
                handleCrossOriginFetch(message, sender).then(sendResponse);
                return true; // keep channel open for async response

            case MessageType.OPEN_TAB:
                chrome.tabs.create({ url: message.url, active: message.active ?? true });
                sendResponse({ ok: true });
                return false;

            case MessageType.OPEN_SETTINGS:
                // Forward to the active tab's content script.
                queryActiveTab().then(tab => {
                    if (tab?.id) {
                        chrome.tabs.sendMessage(tab.id, { type: MessageType.OPEN_SETTINGS });
                    }
                });
                sendResponse({ ok: true });
                return false;

            default:
                sendResponse({ ok: false, error: `Unknown message type` });
                return false;
        }
    }
);

async function handleCrossOriginFetch(
    msg: CrossOriginFetchMessage,
    _sender: chrome.runtime.MessageSender,
): Promise<CrossOriginFetchResponse> {
    try {
        const controller = new AbortController();
        const timer = msg.timeout ? setTimeout(() => controller.abort(), msg.timeout) : null;

        const response = await fetch(msg.url, {
            method: msg.method,
            headers: msg.headers,
            body: msg.body,
            signal: controller.signal,
        });

        if (timer) clearTimeout(timer);

        if (msg.responseType === 'blob') {
            const buffer = await response.arrayBuffer();
            return {
                ok: response.ok,
                status: response.status,
                data: Array.from(new Uint8Array(buffer)),
                finalUrl: response.url,
            };
        }

        const text = await response.text();
        return {
            ok: response.ok,
            status: response.status,
            data: text,
            finalUrl: response.url,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('abort')) {
            return { ok: false, status: 0, data: null, finalUrl: msg.url, error: 'Request timed out.' };
        }
        return { ok: false, status: 0, data: null, finalUrl: msg.url, error: message };
    }
}

async function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
}
