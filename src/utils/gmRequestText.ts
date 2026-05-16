import { GM_xmlhttpRequest } from '$';

export interface GmTextRequestOptions {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
}

export interface GmTextResponse {
    ok: boolean;
    status: number;
    responseText: string;
    finalUrl: string;
    reason?: string;
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
            onload: (response: GmTextLoadResponse) => {
                const status = response.status || 0;
                resolve({
                    ok: status >= 200 && status < 400,
                    status,
                    responseText: response.responseText || '',
                    finalUrl: response.finalUrl || options.url,
                });
            },
            onerror: () => {
                resolve({
                    ok: false,
                    status: 0,
                    responseText: '',
                    finalUrl: options.url,
                    reason: 'Network error.',
                });
            },
            ontimeout: () => {
                resolve({
                    ok: false,
                    status: 0,
                    responseText: '',
                    finalUrl: options.url,
                    reason: 'Request timed out.',
                });
            },
        });
    });
}
