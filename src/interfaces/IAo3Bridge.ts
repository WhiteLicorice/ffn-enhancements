import type { IAo3Chapter } from './IAo3Migration';

export const AO3_BRIDGE_REQUEST_KEY = 'ffne_ao3_bridge_request';
export const AO3_BRIDGE_RESULT_KEY = 'ffne_ao3_bridge_result';
export const AO3_BRIDGE_HEARTBEAT_KEY = 'ffne_ao3_bridge_heartbeat';

export const AO3_BRIDGE_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const AO3_BRIDGE_POLL_INTERVAL_MS = 250;
export const AO3_BRIDGE_HEARTBEAT_INTERVAL_MS = 2000;
export const AO3_BRIDGE_REUSE_HEARTBEAT_MS = AO3_BRIDGE_HEARTBEAT_INTERVAL_MS + 1500;
export const AO3_BRIDGE_HEARTBEAT_STALE_MS = 15000;

export type Ao3BridgeRequestKind = 'loadChapterIndex' | 'updateChapterContent';

export interface Ao3LoadChapterIndexRequest {
    id: string;
    kind: 'loadChapterIndex';
    createdAt: number;
    workUrl: string;
}

export interface Ao3UpdateChapterContentRequest {
    id: string;
    kind: 'updateChapterContent';
    createdAt: number;
    chapter: IAo3Chapter;
    html: string;
}

export type Ao3BridgeRequest = Ao3LoadChapterIndexRequest | Ao3UpdateChapterContentRequest;

export interface Ao3BridgeResult {
    id: string;
    kind: Ao3BridgeRequestKind;
    ok: boolean;
    chapters?: IAo3Chapter[];
    reason?: string;
    status?: number;
    finalUrl?: string;
}

export interface Ao3BridgeHeartbeat {
    at: number;
    url: string;
    loggedIn: boolean;
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function isBridgeKind(value: unknown): value is Ao3BridgeRequestKind {
    return value === 'loadChapterIndex' || value === 'updateChapterContent';
}

function isChapter(value: unknown): value is IAo3Chapter {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const chapter = value as Partial<Record<keyof IAo3Chapter, unknown>>;
    return typeof chapter.workId === 'string'
        && typeof chapter.chapterId === 'string'
        && typeof chapter.chapterNumber === 'number'
        && typeof chapter.label === 'string'
        && typeof chapter.title === 'string'
        && typeof chapter.readerUrl === 'string'
        && typeof chapter.editUrl === 'string';
}

export function serializeAo3BridgeRequest(request: Ao3BridgeRequest): string {
    return JSON.stringify(request);
}

export function serializeAo3BridgeResult(result: Ao3BridgeResult): string {
    return JSON.stringify(result);
}

export function serializeAo3BridgeHeartbeat(heartbeat: Ao3BridgeHeartbeat): string {
    return JSON.stringify(heartbeat);
}

export function parseAo3BridgeRequest(raw: unknown): Ao3BridgeRequest | null {
    const parsed = parseJsonObject(raw);
    if (!parsed) return null;

    const { id, kind, createdAt } = parsed;
    if (typeof id !== 'string' || !isBridgeKind(kind) || typeof createdAt !== 'number') return null;

    if (kind === 'loadChapterIndex') {
        return typeof parsed.workUrl === 'string'
            ? { id, kind, createdAt, workUrl: parsed.workUrl }
            : null;
    }

    if (!isChapter(parsed.chapter) || typeof parsed.html !== 'string') return null;
    return {
        id,
        kind,
        createdAt,
        chapter: parsed.chapter,
        html: parsed.html,
    };
}

export function parseAo3BridgeResult(raw: unknown): Ao3BridgeResult | null {
    const parsed = parseJsonObject(raw);
    if (!parsed) return null;

    const { id, kind, ok } = parsed;
    if (typeof id !== 'string' || !isBridgeKind(kind) || typeof ok !== 'boolean') return null;

    const result: Ao3BridgeResult = { id, kind, ok };
    if (Array.isArray(parsed.chapters) && parsed.chapters.every(isChapter)) {
        result.chapters = parsed.chapters;
    }
    if (typeof parsed.reason === 'string') result.reason = parsed.reason;
    if (typeof parsed.status === 'number') result.status = parsed.status;
    if (typeof parsed.finalUrl === 'string') result.finalUrl = parsed.finalUrl;
    return result;
}

export function parseAo3BridgeHeartbeat(raw: unknown): Ao3BridgeHeartbeat | null {
    const parsed = parseJsonObject(raw);
    if (!parsed) return null;
    if (typeof parsed.at !== 'number' || typeof parsed.url !== 'string' || typeof parsed.loggedIn !== 'boolean') {
        return null;
    }
    return {
        at: parsed.at,
        url: parsed.url,
        loggedIn: parsed.loggedIn,
    };
}
