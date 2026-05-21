import { MessageType, type CrossOriginFetchMessage, type CrossOriginFetchResponse } from '../background/message-types';
import { extensionApi } from './extensionApi';
import { base64ToBytes } from '../utils/base64';
import { bytesToArrayBuffer } from '../utils/zip';

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
        const response = await extensionApi.runtime.sendMessage<CrossOriginFetchResponse>(message);

        if (options.responseType === 'blob' && typeof response.dataBase64 === 'string') {
            return {
                ok: response.ok,
                status: response.status,
                data: new Blob([bytesToArrayBuffer(base64ToBytes(response.dataBase64))], {
                    type: response.mimeType ?? 'application/octet-stream',
                }),
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
