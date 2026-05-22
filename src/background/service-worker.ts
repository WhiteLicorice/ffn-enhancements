import { MessageType } from './message-types';
import type {
    BackgroundMessage,
    CrossOriginFetchMessage,
    CrossOriginFetchResponse,
} from './message-types';
import {
    extensionApi,
    type ExtensionRuntimeMessageListener,
    type ExtensionRuntimeMessageSender,
} from '../platform/extensionApi';
import { bytesToBase64 } from '../utils/base64';

console.log('FFN Enhancements service worker loaded.');

const onMessage: ExtensionRuntimeMessageListener = (message, sender, sendResponse) => {
    void handleMessage(message as BackgroundMessage, sender)
        .then((response) => sendResponse(response))
        .catch((err) => sendResponse({ ok: false, error: getErrorMessage(err) }));
    return true;
};

extensionApi.runtime.onMessage.addListener(onMessage);

async function handleMessage(
    message: BackgroundMessage,
    sender: ExtensionRuntimeMessageSender,
): Promise<unknown> {
    switch (message.type) {
        case MessageType.CROSS_ORIGIN_FETCH:
            return handleCrossOriginFetch(message, sender);

        case MessageType.OPEN_TAB:
            try {
                await extensionApi.tabs.create({ url: message.url, active: message.active ?? true });
                return { ok: true };
            } catch (err) {
                return { ok: false, error: getErrorMessage(err) };
            }

        default:
            return { ok: false, error: 'Unknown message type' };
    }
}

async function handleCrossOriginFetch(
    msg: CrossOriginFetchMessage,
    _sender: ExtensionRuntimeMessageSender,
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
            const bytes = new Uint8Array(await response.arrayBuffer());
            return {
                ok: response.ok,
                status: response.status,
                dataBase64: bytesToBase64(bytes),
                mimeType: response.headers.get('content-type') ?? undefined,
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
