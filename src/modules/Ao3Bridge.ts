import { GM_addValueChangeListener, GM_deleteValue, GM_getValue, GM_setValue } from '$';
import {
    AO3_BRIDGE_DEFAULT_TIMEOUT_MS,
    AO3_BRIDGE_HEARTBEAT_INTERVAL_MS,
    AO3_BRIDGE_HEARTBEAT_KEY,
    AO3_BRIDGE_REQUEST_KEY,
    AO3_BRIDGE_RESULT_KEY,
    Ao3BridgeRequest,
    Ao3BridgeResult,
    parseAo3BridgeRequest,
    parseAo3BridgeResult,
    serializeAo3BridgeHeartbeat,
    serializeAo3BridgeResult,
} from '../interfaces/IAo3Bridge';
import { Core } from './Core';
import { Ao3Service } from '../services/Ao3Service';
import { markFfneUiRoot } from '../utils/ffneUi';

const PANEL_ID = 'ffne-ao3-bridge-panel';
const AO3_BRIDGE_MAX_FUTURE_SKEW_MS = 30 * 1000;

function bridgeResultForError(request: Ao3BridgeRequest, reason: string): Ao3BridgeResult {
    return {
        id: request.id,
        kind: request.kind,
        ok: false,
        reason,
    };
}

function hasResultForRequest(request: Ao3BridgeRequest): boolean {
    const result = parseAo3BridgeResult(GM_getValue(AO3_BRIDGE_RESULT_KEY));
    return !!result && result.id === request.id && result.kind === request.kind;
}

function invalidRequestTimestampReason(request: Ao3BridgeRequest, now: number): string | null {
    if (request.createdAt <= 0) {
        return 'AO3 bridge request timestamp is invalid.';
    }
    if (request.createdAt - now > AO3_BRIDGE_MAX_FUTURE_SKEW_MS) {
        return 'AO3 bridge request timestamp is too far in the future.';
    }
    if (now - request.createdAt > AO3_BRIDGE_DEFAULT_TIMEOUT_MS) {
        return 'AO3 bridge request expired before it could be handled.';
    }
    return null;
}

export const Ao3Bridge = {
    MODULE_NAME: 'Ao3Bridge',
    _initialized: false,
    _activeRequestId: null as string | null,
    _lastHandledRequestId: null as string | null,
    _heartbeatTimer: null as number | null,

    init(): void {
        if (this._initialized) return;
        this._initialized = true;

        this._injectPanel();
        this._writeHeartbeat();
        this._setStatus('Waiting for FFN migration requests.', false);

        try {
            GM_addValueChangeListener(AO3_BRIDGE_REQUEST_KEY, () => {
                void this._processPendingRequest();
            });
        } catch (err) {
            Core.getLogger(this.MODULE_NAME, 'init')('GM_addValueChangeListener unavailable; heartbeat polling remains active.', err);
        }

        this._heartbeatTimer = window.setInterval(() => {
            this._writeHeartbeat();
            void this._processPendingRequest();
        }, AO3_BRIDGE_HEARTBEAT_INTERVAL_MS);

        void this._processPendingRequest();
    },

    _writeHeartbeat(): void {
        // FFN uses this heartbeat to decide whether it can reuse an existing
        // AO3 bridge tab or needs to open AO3 in the foreground.
        GM_setValue(AO3_BRIDGE_HEARTBEAT_KEY, serializeAo3BridgeHeartbeat({
            at: Date.now(),
            url: window.location.href,
            loggedIn: Ao3Service._isLoggedInDocument(document),
        }));
    },

    _isReadyForRequests(): boolean {
        return Ao3Service._isLoggedInDocument(document);
    },

    async _processPendingRequest(): Promise<void> {
        const log = Core.getLogger(this.MODULE_NAME, '_processPendingRequest');
        const request = parseAo3BridgeRequest(GM_getValue(AO3_BRIDGE_REQUEST_KEY));
        if (!request) {
            this._setStatus('Waiting for FFN migration requests.', false);
            return;
        }

        if (this._activeRequestId === request.id || this._lastHandledRequestId === request.id || hasResultForRequest(request)) {
            return;
        }

        const timestampFailure = invalidRequestTimestampReason(request, Date.now());
        if (timestampFailure) {
            const result = bridgeResultForError(request, timestampFailure);
            GM_deleteValue(AO3_BRIDGE_REQUEST_KEY);
            GM_setValue(AO3_BRIDGE_RESULT_KEY, serializeAo3BridgeResult(result));
            this._lastHandledRequestId = request.id;
            this._setStatus(result.reason || 'AO3 bridge request timestamp was rejected.');
            log('Discarded AO3 bridge request with invalid timestamp.', {
                id: request.id,
                kind: request.kind,
                createdAt: request.createdAt,
            });
            return;
        }

        if (!this._isReadyForRequests()) {
            // Leave the request in storage. Once the user finishes AO3 sign-in
            // or Cloudflare and the page becomes logged-in, the heartbeat poll
            // will pick up and process the same pending request.
            this._setStatus('Sign in to AO3 or complete the browser check to continue FFN migration.');
            return;
        }

        this._activeRequestId = request.id;
        this._setStatus(request.kind === 'loadChapterIndex'
            ? 'Loading AO3 chapter list for FFN migration...'
            : 'Updating AO3 chapter from FFN migration...');

        try {
            const result = await this._handleRequest(request);
            GM_setValue(AO3_BRIDGE_RESULT_KEY, serializeAo3BridgeResult(result));
            this._lastHandledRequestId = request.id;
            this._setStatus(result.ok
                ? 'AO3 bridge request completed.'
                : result.reason || 'AO3 bridge request failed.');
            log('AO3 bridge request handled.', {
                id: request.id,
                kind: request.kind,
                ok: result.ok,
                reason: result.reason,
            });
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            GM_setValue(AO3_BRIDGE_RESULT_KEY, serializeAo3BridgeResult(
                bridgeResultForError(request, `Unexpected AO3 bridge error: ${reason}`)
            ));
            this._lastHandledRequestId = request.id;
            this._setStatus(`AO3 bridge request failed: ${reason}`);
            log('AO3 bridge request threw.', err);
        } finally {
            this._activeRequestId = null;
        }
    },

    async _handleRequest(request: Ao3BridgeRequest): Promise<Ao3BridgeResult> {
        const requester = Ao3Service.createSameOriginFetchRequester();

        if (request.kind === 'loadChapterIndex') {
            const result = await Ao3Service.fetchChapterIndex(request.workUrl, requester);
            return {
                id: request.id,
                kind: request.kind,
                ok: result.ok,
                chapters: result.ok ? result.chapters : undefined,
                reason: result.reason,
                status: result.status,
            };
        }

        const result = await Ao3Service.updateChapterContent(request.chapter, request.html, requester);
        return {
            id: request.id,
            kind: request.kind,
            ok: result.ok,
            reason: result.reason,
            status: result.status,
            finalUrl: result.finalUrl,
        };
    },

    _injectPanel(): void {
        if (document.getElementById(PANEL_ID)) return;

        const panel = markFfneUiRoot(document.createElement('div'));
        panel.id = PANEL_ID;
        panel.className = 'ffne-ao3-panel';
        panel.setAttribute('role', 'status');
        document.body.appendChild(panel);
    },

    _setStatus(message: string, visible: boolean = true): void {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        panel.style.display = visible ? 'block' : 'none';
        panel.textContent = `FFN AO3 Bridge: ${message}`;
    },
};
