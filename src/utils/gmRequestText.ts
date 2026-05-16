import { GM_xmlhttpRequest } from '$';
import { isCloudflareChallenge } from './cloudflareChallenge';

export interface GmTextRequestOptions {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
    cookie?: string;
    fetch?: boolean;
}

export interface GmTextResponse {
    ok: boolean;
    status: number;
    responseText: string;
    finalUrl: string;
    reason?: string;
    isCfChallenge: boolean;
}

interface GmTextLoadResponse {
    status?: number;
    responseText?: string;
    finalUrl?: string;
}

export function gmRequestText(options: GmTextRequestOptions): Promise<GmTextResponse> {
    return new Promise((resolve) => {
        GM_xmlhttpRequest({
            method: options.method,
            url: options.url,
            headers: options.headers,
            data: options.data,
            timeout: options.timeout,
            cookie: options.cookie,
            fetch: options.fetch,
            onload: (response: GmTextLoadResponse) => {
                const status = response.status || 0;
                const text = response.responseText || '';
                resolve({
                    ok: status >= 200 && status < 400,
                    status,
                    responseText: text,
                    finalUrl: response.finalUrl || options.url,
                    isCfChallenge: isCloudflareChallenge(status, text),
                });
            },
            onerror: () => {
                resolve({
                    ok: false,
                    status: 0,
                    responseText: '',
                    finalUrl: options.url,
                    reason: 'Network error.',
                    isCfChallenge: false,
                });
            },
            ontimeout: () => {
                resolve({
                    ok: false,
                    status: 0,
                    responseText: '',
                    finalUrl: options.url,
                    reason: 'Request timed out.',
                    isCfChallenge: false,
                });
            },
        });
    });
}
