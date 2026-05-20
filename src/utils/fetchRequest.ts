import { backgroundFetch } from '../platform/messaging';
import type { FetchResponse } from '../platform/messaging';
import { isCloudflareChallenge } from './cloudflareChallenge';

export interface FetchRequestOptions {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
}

export interface FetchTextResponse {
    ok: boolean;
    status: number;
    responseText: string;
    finalUrl: string;
    reason?: string;
    isCfChallenge: boolean;
}

/**
 * Performs a cross-origin fetch via the service worker.
 * Replaces `GM_xmlhttpRequest` from the old userscript version.
 */
export async function fetchRequestText(options: FetchRequestOptions): Promise<FetchTextResponse> {
    const response: FetchResponse = await backgroundFetch({
        url: options.url,
        method: options.method,
        headers: options.headers,
        body: options.data,
        timeout: options.timeout,
        responseType: 'text',
    });

    const text = typeof response.data === 'string' ? response.data : '';

    return {
        ok: response.ok,
        status: response.status,
        responseText: text,
        finalUrl: response.finalUrl,
        reason: response.error,
        isCfChallenge: isCloudflareChallenge(response.status, text),
    };
}
