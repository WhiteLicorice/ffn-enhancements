import { ISitewideModule } from '../interfaces/ISiteWideModule';
import { markFfneUiRoot } from '../utils/ffneUi';
import { FFNLogger } from './FFNLogger';
import { SettingsPage } from './SettingsPage';

const MODULE_NAME = 'SettingsIconHijacker';
const ICON_SELECTOR = '.icon-kub-mobile';
const HIJACK_ATTR = 'data-ffne-hijacked';
const LABEL = 'FFN Enhancements settings';
const OBSERVER_TIMEOUT_MS = 5000;

let observer: MutationObserver | null = null;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
let domReadyListenerBound = false;

export const SettingsIconHijacker: ISitewideModule = {
    prime(): void {
        if (_bindIcons()) return;
        _armObserver();
    },

    init(): void {
        if (_bindIcons()) return;
        FFNLogger.log(MODULE_NAME, 'init', 'No .icon-kub-mobile element found on this FFN page.');
    },
};

function _bindIcons(): boolean {
    const icons = Array.from(document.querySelectorAll<HTMLElement>(ICON_SELECTOR));
    if (!icons.length) return false;

    let didBind = false;
    for (const icon of icons) {
        if (icon.hasAttribute(HIJACK_ATTR)) continue;
        didBind = true;
        _bindIcon(icon);
    }

    if (didBind || icons.some((icon) => icon.hasAttribute(HIJACK_ATTR))) {
        _disconnectObserver();
        return true;
    }

    return false;
}

function _bindIcon(icon: HTMLElement): void {
    icon.setAttribute(HIJACK_ATTR, '1');
    icon.setAttribute('aria-label', LABEL);
    icon.setAttribute('title', LABEL);
    icon.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        SettingsPage.openModal();
    }, { capture: true });
    _attachAffordance(icon);
}

function _attachAffordance(icon: HTMLElement): void {
    const wrapper = markFfneUiRoot(document.createElement('span'));
    icon.insertAdjacentElement('afterend', wrapper);

    const shadow = wrapper.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
        <style>
            :host { all: initial; position: relative; display: contents; }
            .tip {
                position: fixed;
                z-index: 2147483647;
                padding: 4px 8px;
                background: #222;
                color: #fff;
                font: 12px/1 system-ui, sans-serif;
                border-radius: 4px;
                opacity: 0;
                pointer-events: none;
                white-space: nowrap;
                transform: translate(-50%, calc(-100% - 8px));
                transition: opacity 120ms ease;
            }
        </style>
        <span class="tip">${LABEL}</span>
    `;

    const tip = shadow.querySelector('.tip');
    if (!(tip instanceof HTMLElement)) return;

    const show = () => {
        const rect = icon.getBoundingClientRect();
        tip.style.left = `${rect.left + rect.width / 2}px`;
        tip.style.top = `${rect.top}px`;
        tip.style.opacity = '1';
    };
    const hide = () => {
        tip.style.opacity = '0';
    };

    icon.addEventListener('mouseenter', show);
    icon.addEventListener('mouseleave', hide);
    icon.addEventListener('focus', show);
    icon.addEventListener('blur', hide);
}

function _armObserver(): void {
    if (!observer) {
        observer = new MutationObserver(() => {
            _bindIcons();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        if (!domReadyListenerBound) {
            document.addEventListener('DOMContentLoaded', _startDisconnectTimer, { once: true });
            domReadyListenerBound = true;
        }
        return;
    }

    _startDisconnectTimer();
}

function _startDisconnectTimer(): void {
    domReadyListenerBound = false;
    if (disconnectTimer !== null) return;
    disconnectTimer = setTimeout(() => {
        _disconnectObserver();
    }, OBSERVER_TIMEOUT_MS);
}

function _disconnectObserver(): void {
    observer?.disconnect();
    observer = null;
    if (disconnectTimer !== null) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
    }
}
