import { ISitewideModule } from '../interfaces/ISiteWideModule';
import { injectStyleOnce } from '../utils/injectStyleOnce';

const MODULE_NAME = 'PaintGate';
const STYLE_ID = 'ffne-paint-gate-style';
const ROOT_CLASS = 'ffne-paint-gated';
const FFN_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net']);
const FAIL_SAFE_TIMEOUT_MS = 5000;
const RELEASE_FALLBACK_TIMEOUT_MS = 100;
const BLACK = '#000';

let _headObserver: MutationObserver | null = null;
let _failSafeTimer: number | null = null;
let _releaseTimer: number | null = null;
let _releaseFrame: number | null = null;
let _previousRootBackground = '';
let _isPrimed = false;

const paintGateCss = `
html.${ROOT_CLASS},
html.${ROOT_CLASS} body {
    background: ${BLACK} !important;
}

html.${ROOT_CLASS} body {
    visibility: hidden !important;
}
`;

export const PaintGate: ISitewideModule & {
    release(): void;
    releaseAfterPaint(): void;
} = {
    prime(): void {
        if (!_isFfnHost()) return;

        _clearReleaseSchedule();
        _ensureStyle();

        if (!_isPrimed) {
            _previousRootBackground = document.documentElement.style.backgroundColor;
        }

        document.documentElement.classList.add(ROOT_CLASS);
        document.documentElement.style.backgroundColor = BLACK;
        _isPrimed = true;

        _watchForHead();
        _armFailSafe();
    },

    init(): void {
        if (!_isPrimed) return;
        _ensureStyle();
    },

    release(): void {
        _clearReleaseSchedule();
        _clearFailSafe();
        _disconnectHeadObserver();

        document.documentElement.classList.remove(ROOT_CLASS);
        document.documentElement.style.backgroundColor = _previousRootBackground;
        document.getElementById(STYLE_ID)?.remove();

        _previousRootBackground = '';
        _isPrimed = false;
    },

    releaseAfterPaint(): void {
        if (!_isPrimed) {
            this.release();
            return;
        }

        _clearReleaseSchedule();

        const runRelease = () => {
            this.release();
        };

        if (typeof window.requestAnimationFrame === 'function') {
            _releaseFrame = window.requestAnimationFrame(() => {
                _releaseFrame = null;
                runRelease();
            });
        }

        _releaseTimer = window.setTimeout(() => {
            _releaseTimer = null;
            runRelease();
        }, RELEASE_FALLBACK_TIMEOUT_MS);
    },
};

function _ensureStyle(): void {
    injectStyleOnce(STYLE_ID, paintGateCss);
}

function _watchForHead(): void {
    if (document.head) {
        _disconnectHeadObserver();
        _ensureStyle();
        return;
    }

    if (_headObserver) return;

    _headObserver = new MutationObserver(() => {
        if (!document.head) return;
        _ensureStyle();
        _disconnectHeadObserver();
    });
    _headObserver.observe(document.documentElement, { childList: true });
}

function _disconnectHeadObserver(): void {
    if (!_headObserver) return;
    _headObserver.disconnect();
    _headObserver = null;
}

function _armFailSafe(): void {
    _clearFailSafe();
    _failSafeTimer = window.setTimeout(() => {
        _failSafeTimer = null;
        if (!_isPrimed) return;
        console.warn(`(ffn-enhancements) ${MODULE_NAME} failSafe: Releasing paint gate after ${FAIL_SAFE_TIMEOUT_MS}ms.`);
        PaintGate.release();
    }, FAIL_SAFE_TIMEOUT_MS);
}

function _clearFailSafe(): void {
    if (_failSafeTimer === null) return;
    window.clearTimeout(_failSafeTimer);
    _failSafeTimer = null;
}

function _clearReleaseSchedule(): void {
    if (_releaseFrame !== null) {
        window.cancelAnimationFrame(_releaseFrame);
        _releaseFrame = null;
    }

    if (_releaseTimer !== null) {
        window.clearTimeout(_releaseTimer);
        _releaseTimer = null;
    }
}

function _isFfnHost(): boolean {
    return FFN_HOSTS.has(window.location.hostname);
}
