import { GM_xmlhttpRequest } from '$';

export interface GmTextRequestOptions {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
    cookie?: string;
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

const CF_MARKERS = [
    'cf-browser-verification',
    'DDoS protection by Cloudflare',
    'Checking your browser',
    'challenge-platform',
    '_cf_chl',
];

function _isCloudflareChallenge(status: number, responseText: string): boolean {
    if (status !== 403) return false;
    return CF_MARKERS.some(marker => responseText.includes(marker));
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
            onload: (response: GmTextLoadResponse) => {
                const status = response.status || 0;
                const text = response.responseText || '';
                resolve({
                    ok: status >= 200 && status < 400,
                    status,
                    responseText: text,
                    finalUrl: response.finalUrl || options.url,
                    isCfChallenge: _isCloudflareChallenge(status, text),
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
