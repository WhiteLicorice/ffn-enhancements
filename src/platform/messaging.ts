// Content-script <-> service-worker messaging.
//
// Content scripts use `sendToBackground()` to request cross-origin fetches
// and other privileged operations. The service worker handles these in its
// chrome.runtime.onMessage listener.

import { MessageType } from '../background/message-types';
import type { CrossOriginFetchMessage, CrossOriginFetchResponse } from '../background/message-types';

export interface FetchRequestOptions {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    responseType?: 'text' | 'blob';
    timeout?: number;
}

export interface FetchResponse {
    ok: boolean;
    status: number;
    data: string | Blob | null;
    finalUrl: string;
    error?: string;
}

/**
 * Sends a cross-origin fetch request through the service worker.
 * The service worker has full host_permissions and no CORS restrictions.
 */
export async function backgroundFetch(options: FetchRequestOptions): Promise<FetchResponse> {
    const message: CrossOriginFetchMessage = {
        type: MessageType.CROSS_ORIGIN_FETCH,
        url: options.url,
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body,
        responseType: options.responseType || 'text',
        timeout: options.timeout,
    };

    const response: CrossOriginFetchResponse = await chrome.runtime.sendMessage(message);

    if (options.responseType === 'blob' && Array.isArray(response.data)) {
        const bytes = new Uint8Array(response.data);
        return {
            ok: response.ok,
            status: response.status,
            data: new Blob([bytes]),
            finalUrl: response.finalUrl,
            error: response.error,
        };
    }

    return {
        ok: response.ok,
        status: response.status,
        data: typeof response.data === 'string' ? response.data : null,
        finalUrl: response.finalUrl,
        error: response.error,
    };
}

/**
 * Sends a message from the service worker (or popup) to the active tab's content script.
 */
export async function sendToActiveTab(message: unknown): Promise<void> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId !== undefined) {
        chrome.tabs.sendMessage(tabId, message);
    }
}

/**
 * Registers a listener for messages from the service worker or popup.
 * Returns an unsubscribe function.
 */
export function onMessage(callback: (message: unknown) => void): () => void {
    const listener = (msg: unknown) => callback(msg);
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
}
