import browser from 'webextension-polyfill';

import { MessageType } from './message-types';
import type { BackgroundMessage, CrossOriginFetchMessage, CrossOriginFetchResponse } from './message-types';

console.log('FFN Enhancements service worker loaded.');

browser.runtime.onMessage.addListener(async (
    message: unknown,
    sender: browser.Runtime.MessageSender,
): Promise<unknown> => {
    const typedMessage = message as BackgroundMessage;
    switch (typedMessage.type) {
        case MessageType.CROSS_ORIGIN_FETCH:
            return handleCrossOriginFetch(typedMessage, sender);

        case MessageType.OPEN_TAB:
            try {
                await browser.tabs.create({ url: typedMessage.url, active: typedMessage.active ?? true });
                return { ok: true };
            } catch (err) {
                return { ok: false, error: getErrorMessage(err) };
            }

        default:
            return { ok: false, error: 'Unknown message type' };
    }
});

async function handleCrossOriginFetch(
    msg: CrossOriginFetchMessage,
    _sender: browser.Runtime.MessageSender,
): Promise<CrossOriginFetchResponse> {
    try {
        const controller = new AbortController();
        const timer = msg.timeout ? setTimeout(() => controller.abort(), msg.timeout) : null;

        const response = await fetch(msg.url, {
            method: msg.method,
            headers: msg.headers,
            body: msg.body,
            credentials: 'include',
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

        return {
            ok: response.ok,
            status: response.status,
            data: await response.text(),
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

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
