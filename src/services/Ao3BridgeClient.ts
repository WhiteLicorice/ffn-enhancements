import { GM_deleteValue, GM_getValue, GM_openInTab, GM_setValue } from '$';
import type { IAo3Chapter } from '../interfaces/IAo3Migration';
import {
    AO3_BRIDGE_DEFAULT_TIMEOUT_MS,
    AO3_BRIDGE_HEARTBEAT_KEY,
    AO3_BRIDGE_REUSE_HEARTBEAT_MS,
    AO3_BRIDGE_HEARTBEAT_STALE_MS,
    AO3_BRIDGE_POLL_INTERVAL_MS,
    AO3_BRIDGE_REQUEST_KEY,
    AO3_BRIDGE_RESULT_KEY,
    Ao3BridgeRequest,
    Ao3BridgeResult,
    parseAo3BridgeHeartbeat,
    parseAo3BridgeRequest,
    parseAo3BridgeResult,
    serializeAo3BridgeRequest,
} from '../interfaces/IAo3Bridge';
import type { Ao3BridgeHeartbeat } from '../interfaces/IAo3Bridge';
import { Core } from '../modules/Core';
import { Ao3ChapterIndexResult, Ao3Service, Ao3UpdateResult } from './Ao3Service';

interface SendOptions {
    timeoutMs?: number;
    pollIntervalMs?: number;
}

function makeRequestId(): string {
    return `ffne-ao3-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requestMatchesResult(request: Ao3BridgeRequest, result: Ao3BridgeResult | null): result is Ao3BridgeResult {
    return !!result && result.id === request.id && result.kind === request.kind;
}

function timeoutReason(timeoutMs: number): string {
    return [
        `AO3 bridge did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
        'Keep the AO3 tab open, complete any Cloudflare challenge, sign in, then retry.',
    ].join(' ');
}

export const Ao3BridgeClient = {
    MODULE_NAME: 'Ao3BridgeClient',

    normalizeWorkUrl(input: string): string | null {
        return Ao3Service.normalizeWorkUrl(input);
    },

    async fetchChapterIndex(workUrl: string, options: SendOptions = {}): Promise<Ao3ChapterIndexResult> {
        const normalized = Ao3Service.normalizeWorkUrl(workUrl);
        if (!normalized) return { ok: false, chapters: [], reason: 'Enter a valid AO3 work URL.' };

        const result = await this._sendRequest({
            id: makeRequestId(),
            kind: 'loadChapterIndex',
            createdAt: Date.now(),
            workUrl: normalized,
        }, normalized, options);

        if (!result.ok) {
            return {
                ok: false,
                chapters: [],
                reason: result.reason || 'AO3 bridge could not load the chapter index.',
                status: result.status,
            };
        }

        if (!result.chapters || result.chapters.length === 0) {
            return { ok: false, chapters: [], reason: 'AO3 bridge returned no chapters.' };
        }

        return { ok: true, chapters: result.chapters };
    },

    async updateChapterContent(
        chapter: IAo3Chapter,
        html: string,
        options: SendOptions = {},
    ): Promise<Ao3UpdateResult> {
        if (!html.trim()) return { ok: false, reason: 'Replacement chapter content is empty.' };

        const result = await this._sendRequest({
            id: makeRequestId(),
            kind: 'updateChapterContent',
            createdAt: Date.now(),
            chapter,
            html,
        }, chapter.editUrl, options);

        return result.ok
            ? { ok: true, finalUrl: result.finalUrl }
            : {
                ok: false,
                reason: result.reason || 'AO3 bridge could not update the chapter.',
                status: result.status,
                finalUrl: result.finalUrl,
            };
    },

    async _sendRequest(
        request: Ao3BridgeRequest,
        openUrl: string,
        options: SendOptions = {},
    ): Promise<Ao3BridgeResult> {
        const timeoutMs = options.timeoutMs ?? AO3_BRIDGE_DEFAULT_TIMEOUT_MS;
        const pollIntervalMs = options.pollIntervalMs ?? AO3_BRIDGE_POLL_INTERVAL_MS;
        // Reuse only very recent heartbeats for the "do not open AO3" path.
        // Older heartbeats may be leftovers from a tab the user already closed.
        const heartbeatAtStart = this._getHeartbeat();
        const hadLiveBridge = this._hasReusableHeartbeat(heartbeatAtStart);

        GM_deleteValue(AO3_BRIDGE_RESULT_KEY);
        GM_setValue(AO3_BRIDGE_REQUEST_KEY, serializeAo3BridgeRequest(request));
        this._ensureBridgeTab(openUrl, hadLiveBridge);

        try {
            return await this._waitForResult(request, {
                timeoutMs,
                pollIntervalMs,
                failOnStaleHeartbeat: hadLiveBridge,
                openUrl,
                heartbeatAtStart: heartbeatAtStart?.at || 0,
                didOpenBridgeTab: !hadLiveBridge,
            });
        } finally {
            this._cleanupRequest(request);
        }
    },

    _ensureBridgeTab(openUrl: string, hadLiveBridge: boolean): void {
        if (hadLiveBridge) return;

        const log = Core.getLogger(this.MODULE_NAME, '_ensureBridgeTab');
        try {
            GM_openInTab(openUrl, { active: true, insert: true });
            log('Opened AO3 bridge tab.', { openUrl });
        } catch (err) {
            log('Could not open AO3 bridge tab.', err);
        }
    },

    _getHeartbeat(): Ao3BridgeHeartbeat | null {
        return parseAo3BridgeHeartbeat(GM_getValue(AO3_BRIDGE_HEARTBEAT_KEY));
    },

    _hasReusableHeartbeat(heartbeat?: Ao3BridgeHeartbeat | null): boolean {
        const current = heartbeat === undefined ? this._getHeartbeat() : heartbeat;
        return !!current && Date.now() - current.at <= AO3_BRIDGE_REUSE_HEARTBEAT_MS;
    },

    _hasFreshHeartbeat(): boolean {
        const heartbeat = this._getHeartbeat();
        return !!heartbeat && Date.now() - heartbeat.at <= AO3_BRIDGE_HEARTBEAT_STALE_MS;
    },

    _hasHeartbeatAdvancedSince(timestamp: number): boolean {
        const heartbeat = this._getHeartbeat();
        return !!heartbeat && heartbeat.at > timestamp;
    },

    _waitForResult(
        request: Ao3BridgeRequest,
        options: {
            timeoutMs: number;
            pollIntervalMs: number;
            failOnStaleHeartbeat: boolean;
            openUrl: string;
            heartbeatAtStart: number;
            didOpenBridgeTab: boolean;
        },
    ): Promise<Ao3BridgeResult> {
        return new Promise((resolve) => {
            const startedAt = Date.now();
            let pollTimer: number | null = null;
            let didOpenBridgeTab = options.didOpenBridgeTab;

            const finish = (result: Ao3BridgeResult) => {
                if (pollTimer !== null) {
                    window.clearInterval(pollTimer);
                    pollTimer = null;
                }
                resolve(result);
            };

            const inspect = () => {
                const result = parseAo3BridgeResult(GM_getValue(AO3_BRIDGE_RESULT_KEY));
                if (requestMatchesResult(request, result)) {
                    finish(result);
                    return;
                }

                // A lingering heartbeat can survive a closed AO3 tab for a few
                // seconds. If it does not advance promptly, open AO3 on this
                // same first request instead of making the user click again.
                if (
                    !didOpenBridgeTab &&
                    Date.now() - startedAt >= AO3_BRIDGE_REUSE_HEARTBEAT_MS &&
                    !this._hasHeartbeatAdvancedSince(options.heartbeatAtStart)
                ) {
                    didOpenBridgeTab = true;
                    this._ensureBridgeTab(options.openUrl, false);
                }

                // Only treat stale heartbeat as fatal when this request started
                // with an already-open AO3 bridge. If AO3 was opened just now,
                // the user may still be clearing Cloudflare or signing in.
                if (options.failOnStaleHeartbeat && !didOpenBridgeTab && !this._hasFreshHeartbeat()) {
                    finish({
                        id: request.id,
                        kind: request.kind,
                        ok: false,
                        reason: 'AO3 bridge tab stopped responding. Reopen AO3 and retry the failed migration.',
                    });
                    return;
                }

                if (Date.now() - startedAt >= options.timeoutMs) {
                    finish({
                        id: request.id,
                        kind: request.kind,
                        ok: false,
                        reason: timeoutReason(options.timeoutMs),
                    });
                }
            };

            pollTimer = window.setInterval(inspect, options.pollIntervalMs);
            inspect();
        });
    },

    _cleanupRequest(request: Ao3BridgeRequest): void {
        const storedRequest = parseAo3BridgeRequest(GM_getValue(AO3_BRIDGE_REQUEST_KEY));
        if (storedRequest?.id === request.id) {
            GM_deleteValue(AO3_BRIDGE_REQUEST_KEY);
        }

        const storedResult = parseAo3BridgeResult(GM_getValue(AO3_BRIDGE_RESULT_KEY));
        if (storedResult?.id === request.id) {
            GM_deleteValue(AO3_BRIDGE_RESULT_KEY);
        }
    },
};
