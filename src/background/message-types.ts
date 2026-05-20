// Shared message types for content-script <-> service-worker communication.

export const enum MessageType {
    /** Content script requests a cross-origin fetch via the service worker. */
    CROSS_ORIGIN_FETCH = 'CROSS_ORIGIN_FETCH',
    /** Content script requests the extension popup to open settings. */
    OPEN_SETTINGS = 'OPEN_SETTINGS',
    /** Content script requests the service worker to open a new tab. */
    OPEN_TAB = 'OPEN_TAB',
}

export interface CrossOriginFetchMessage {
    type: MessageType.CROSS_ORIGIN_FETCH;
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    responseType?: 'text' | 'blob';
    timeout?: number;
}

export interface CrossOriginFetchResponse {
    ok: boolean;
    status: number;
    data: string | number[] | null;
    finalUrl: string;
    error?: string;
}

export interface OpenSettingsMessage {
    type: MessageType.OPEN_SETTINGS;
}

export interface OpenTabMessage {
    type: MessageType.OPEN_TAB;
    url: string;
    active?: boolean;
}

export type BackgroundMessage = CrossOriginFetchMessage | OpenSettingsMessage | OpenTabMessage;
