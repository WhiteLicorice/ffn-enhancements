// Shared message types for content-script <-> service-worker communication.
//
// Use plain string constants instead of const enum — esbuild does not inline
// const enum values, and TypeScript does not emit them at runtime, so the
// compiled bundle would get `undefined` for every enum member reference.

export const MessageType = {
    CROSS_ORIGIN_FETCH: 'CROSS_ORIGIN_FETCH',
    OPEN_TAB: 'OPEN_TAB',
    ENSURE_FICHUB_PERMISSION: 'ENSURE_FICHUB_PERMISSION',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface CrossOriginFetchMessage {
    type: typeof MessageType.CROSS_ORIGIN_FETCH;
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

export interface OpenTabMessage {
    type: typeof MessageType.OPEN_TAB;
    url: string;
    active?: boolean;
}

export interface EnsureFicHubPermissionMessage {
    type: typeof MessageType.ENSURE_FICHUB_PERMISSION;
}

export interface EnsureFicHubPermissionResponse {
    ok: boolean;
    granted: boolean;
    error?: string;
}

export type BackgroundMessage = CrossOriginFetchMessage | OpenTabMessage | EnsureFicHubPermissionMessage;
