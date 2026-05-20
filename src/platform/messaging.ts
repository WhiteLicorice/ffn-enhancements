// Content-script <-> service-worker messaging.
//
// Content scripts use `backgroundFetch()` to request cross-origin fetches
// and other privileged operations. The service worker handles these in its
// chrome.runtime.onMessage listener.
//
// All cross-origin HTTP requests flow through the service worker because:
// 1. Content scripts may face CSP restrictions from the host page.
// 2. Service worker has unrestricted fetch() for declared host_permissions.
// 3. Consistent behavior across Chrome and Firefox.

import { MessageType } from '../background/message-types';
import type { CrossOriginFetchMessage, CrossOriginFetchResponse } from '../background/message-types';

export interface FetchRequestOptions {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    /** 'blob' returns response data as a Blob (for binary downloads). */
    responseType?: 'text' | 'blob';
    /** Timeout in ms. The service worker aborts the fetch after this duration. */
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
 *
 * Returns a FetchResponse with data as string (text mode) or Blob (blob mode).
 * Never throws — errors are returned in the response object.
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

    try {
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
    } catch (err) {
        // chrome.runtime.sendMessage throws if the service worker is not running
        // or if the extension context is invalid.
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            status: 0,
            data: null,
            finalUrl: options.url,
            error: `Messaging error: ${message}`,
        };
    }
}

/**
 * Sends a message from the service worker (or popup) to the active tab's content script.
 * Used to trigger actions like opening the settings modal.
 */
export async function sendToActiveTab(message: unknown): Promise<void> {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (tabId !== undefined) {
            await chrome.tabs.sendMessage(tabId, message);
        }
    } catch {
        // Tab may not be ready to receive messages (e.g., no content script loaded).
    }
}

/**
 * Registers a listener for messages from the service worker or popup.
 * Returns an unsubscribe function for cleanup.
 *
 * Use this in content scripts to handle incoming messages:
 *   const unsub = onMessage((msg) => { ... });
 *   // later: unsub();
 */
export function onMessage(
    callback: (message: Record<string, unknown>, sender: chrome.runtime.MessageSender) => void,
): () => void {
    const listener = (
        message: Record<string, unknown>,
        sender: chrome.runtime.MessageSender,
    ) => {
        callback(message, sender);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
}
