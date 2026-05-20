import { ISitewideModule } from '../interfaces/ISiteWideModule';
import { injectStyleOnce } from '../utils/injectStyleOnce';

const MODULE_NAME = 'PaintGate';
const STYLE_ID = 'ffne-paint-gate-style';
const OVERLAY_ID = 'ffne-paint-gate-overlay';
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
    color-scheme: dark !important;
}

html.${ROOT_CLASS} body {
    opacity: 0 !important;
    pointer-events: none !important;
    transition: none !important;
}

html.${ROOT_CLASS}::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: ${BLACK};
    pointer-events: none;
}
`;

const overlayStyle = [
    'position:fixed !important',
    'inset:0 !important',
    'width:100vw !important',
    'height:100vh !important',
    'z-index:2147483647 !important',
    `background:${BLACK} !important`,
    'display:block !important',
    'visibility:visible !important',
    'opacity:1 !important',
    'pointer-events:none !important',
    'margin:0 !important',
    'padding:0 !important',
    'border:0 !important',
    'box-shadow:none !important',
    'contain:strict !important',
].join(';');

export const PaintGate: ISitewideModule & {
    release(): void;
    releaseAfterPaint(): void;
} = {
    prime(): void {
        if (!_isFfnHost()) return;

        _clearReleaseSchedule();
        _ensureStyle();
        _ensureOverlay();

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

        const wasPrimed = _isPrimed;
        const root = document.documentElement;
        const shouldRestoreBackground = root.style.backgroundColor === BLACK || root.style.backgroundColor === 'rgb(0, 0, 0)';

        root.classList.remove(ROOT_CLASS);
        if (wasPrimed && shouldRestoreBackground) {
            root.style.backgroundColor = _previousRootBackground;
        }
        document.getElementById(STYLE_ID)?.remove();
        document.getElementById(OVERLAY_ID)?.remove();

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

function _ensureOverlay(): void {
    const root = document.documentElement;
    if (!root) return;

    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.setAttribute('aria-hidden', 'true');
    }

    overlay.setAttribute('style', overlayStyle);

    if (overlay.parentNode !== root) {
        root.appendChild(overlay);
    }
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
        _ensureOverlay();
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
