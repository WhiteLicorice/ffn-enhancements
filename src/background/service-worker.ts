// Service worker entry point for FFN Enhancements MV3 extension.
// Handles cross-origin fetch proxying and tab management on behalf of content scripts.

import { MessageType } from './message-types';
import type { BackgroundMessage, CrossOriginFetchMessage, CrossOriginFetchResponse } from './message-types';
import {
    CONTENT_SCRIPT_CSS_FILES,
    CONTENT_SCRIPT_JS_FILES,
    CONTENT_SCRIPT_TAB_PATTERNS,
    REQUESTED_HOST_PATTERNS,
} from './contentScriptManifest';

const FFN_HOME_URL = 'https://www.fanfiction.net/';
const OPEN_SETTINGS_TIMEOUT_MS = 30_000;
const SUPPORTED_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net', 'archiveofourown.org']);

console.log('FFN Enhancements service worker loaded.');

// Clicking the extension icon opens the Settings modal on the active tab.
// Resolve the action API once. Firefox prefers `browser.action`; both Chrome
// and Firefox also expose `chrome.action` as a compat alias. Registering once
// against whichever is present avoids edge cases where one binding is stale
// during event-page wake-up.
const actionApi: typeof chrome.action =
    (globalThis as { browser?: { action?: typeof chrome.action } }).browser?.action
    ?? chrome.action;

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return;
    void ensureHostPermissionsThenInject().catch((err) => {
        console.warn(
            'FFN-Enhancements: onInstalled host-permission probe failed (expected on Firefox).',
            err,
        );
    });
});

chrome.permissions.onAdded.addListener((permissions) => {
    if (!permissions.origins?.length) return;
    void injectIntoMatchingTabs().catch((err) => {
        console.error('FFN-Enhancements: post-permission inject failed.', err);
    });
});

chrome.permissions.onRemoved.addListener((permissions) => {
    if (!permissions.origins?.length) return;
    console.warn(
        'FFN-Enhancements: host permissions revoked. Features unavailable on new tab loads until re-granted.',
        permissions.origins,
    );
});

actionApi.onClicked.addListener(async (tab) => {
    const granted = await ensureHostPermissions();
    if (!granted) {
        console.warn('FFN-Enhancements: user declined host permissions; only the current click can inject (activeTab).');
    }
    await openSettingsForTab(tab);
});

chrome.runtime.onMessage.addListener(
    (message: BackgroundMessage, sender, sendResponse: (response: unknown) => void) => {
        switch (message.type) {
            case MessageType.CROSS_ORIGIN_FETCH:
                handleCrossOriginFetch(message, sender).then(sendResponse);
                return true; // keep channel open for async response

            case MessageType.OPEN_TAB:
                tabsCreate({ url: message.url, active: message.active ?? true })
                    .then(() => sendResponse({ ok: true }))
                    .catch(err => sendResponse({ ok: false, error: getErrorMessage(err) }));
                return true;

            case MessageType.OPEN_SETTINGS:
                // Forward to the active tab's content script.
                openSettingsForActiveTab();
                sendResponse({ ok: true });
                return false;

            default:
                sendResponse({ ok: false, error: `Unknown message type` });
                return false;
        }
    }
);

async function handleCrossOriginFetch(
    msg: CrossOriginFetchMessage,
    _sender: chrome.runtime.MessageSender,
): Promise<CrossOriginFetchResponse> {
    try {
        const controller = new AbortController();
        const timer = msg.timeout ? setTimeout(() => controller.abort(), msg.timeout) : null;

        const response = await fetch(msg.url, {
            method: msg.method,
            headers: msg.headers,
            body: msg.body,
            credentials: 'include',
            signal: controller.signal,
        });

        if (timer) clearTimeout(timer);

        if (msg.responseType === 'blob') {
            const buffer = await response.arrayBuffer();
            return {
                ok: response.ok,
                status: response.status,
                data: Array.from(new Uint8Array(buffer)),
                finalUrl: response.url,
            };
        }

        const text = await response.text();
        return {
            ok: response.ok,
            status: response.status,
            data: text,
            finalUrl: response.url,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('abort')) {
            return { ok: false, status: 0, data: null, finalUrl: msg.url, error: 'Request timed out.' };
        }
        return { ok: false, status: 0, data: null, finalUrl: msg.url, error: message };
    }
}

async function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    return tabs[0];
}

async function openSettingsForActiveTab(): Promise<void> {
    const tab = await queryActiveTab();
    await openSettingsForTab(tab);
}

async function openSettingsForTab(tab: chrome.tabs.Tab | undefined): Promise<void> {
    if (tab?.id !== undefined && isSupportedTab(tab)) {
        await openSettingsInTab(tab.id);
        return;
    }

    const createdTab = await tabsCreate({ url: FFN_HOME_URL, active: true });
    if (createdTab.id !== undefined) {
        queueOpenSettingsWhenTabLoads(createdTab.id);
    }
}

async function openSettingsInTab(tabId: number): Promise<boolean> {
    // Dispatch chain: chrome.tabs.sendMessage gives clean failure semantics
    // ("Receiving end does not exist" on missing listener), so we can detect
    // whether the content script's OPEN_SETTINGS handler is registered.
    //
    // Step 1: Try sendMessage. If the content script is already loaded
    //         (Chrome default; Firefox with host permission granted), the
    //         OPEN_SETTINGS handler fires and the modal opens immediately.
    if (await sendOpenSettings(tabId)) {
        console.log('FFN-Enhancements: settings dispatched via sendMessage (step 1).');
        return true;
    }

    // Step 2: sendMessage failed -> no listener. This happens on Firefox MV3
    //         when host_permissions are user-opt-in and have not been granted:
    //         manifest content_scripts do NOT auto-execute, so SettingsMenu's
    //         runtime listener was never registered. activeTab (granted by
    //         the click) lets us inject the content script ourselves.
    if (!(await injectFullContentScripts(tabId))) {
        console.error('FFN-Enhancements: cannot dispatch settings — injection failed (step 2).');
        return false;
    }
    console.log('FFN-Enhancements: full content scripts injected via activeTab (step 2).');

    // Step 3: Retry sendMessage. main.js bootstrap is synchronous, so by the
    //         time scripting.executeScript({files}) resolves, the OPEN_SETTINGS
    //         listener is registered.
    if (await sendOpenSettings(tabId)) {
        console.log('FFN-Enhancements: settings dispatched via sendMessage after inject (step 3).');
        return true;
    }

    console.error('FFN-Enhancements: sendMessage failed after injection — listener missing.');
    return false;
}

async function sendOpenSettings(tabId: number): Promise<boolean> {
    try {
        await tabsSendMessage(tabId, { type: MessageType.OPEN_SETTINGS });
        return true;
    } catch {
        // Expected when no listener exists ("Receiving end does not exist").
        return false;
    }
}

async function ensureHostPermissions(): Promise<boolean> {
    if (await permissionsContains({ origins: [...REQUESTED_HOST_PATTERNS] })) return true;
    return permissionsRequest({ origins: [...REQUESTED_HOST_PATTERNS] });
}

async function ensureHostPermissionsThenInject(): Promise<boolean> {
    const granted = await ensureHostPermissions();
    if (granted) {
        await injectIntoMatchingTabs();
    }
    return granted;
}

async function injectIntoMatchingTabs(): Promise<void> {
    const tabs = await tabsQuery({ url: [...CONTENT_SCRIPT_TAB_PATTERNS] });
    await Promise.all(
        tabs
            .filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined)
            .map((tab) => injectFullContentScripts(tab.id)),
    );
}

async function injectFullContentScripts(tabId: number): Promise<boolean> {
    try {
        await scriptingInsertCSS({
            target: { tabId },
            files: [...CONTENT_SCRIPT_CSS_FILES],
        });
        for (const file of CONTENT_SCRIPT_JS_FILES) {
            await scriptingExecuteScript({
                target: { tabId },
                files: [file],
            });
        }
        console.log(`FFN-Enhancements: full content scripts injected into tab ${tabId}.`);
        return true;
    } catch (err) {
        console.error('FFN-Enhancements: full content-script injection failed.', err);
        return false;
    }
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

type ChromeAsyncStarter<T> = (callback: (value: T) => void) => Promise<T> | void;

function chromeAsync<T>(start: ChromeAsyncStarter<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        let settled = false;

        const settle = (err: unknown, value?: T) => {
            if (settled) return;
            settled = true;
            if (err) {
                reject(err);
            } else {
                resolve(value as T);
            }
        };

        try {
            const maybePromise = start((value: T) => {
                const err = chrome.runtime.lastError;
                settle(err ? new Error(err.message) : null, value);
            });

            if (maybePromise && typeof (maybePromise as Promise<T>).then === 'function') {
                (maybePromise as Promise<T>).then(
                    value => settle(null, value),
                    err => settle(err),
                );
            }
        } catch (err) {
            settle(err);
        }
    });
}

function tabsQuery(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
    return chromeAsync<chrome.tabs.Tab[]>((callback) => (
        chrome.tabs.query(queryInfo, callback) as unknown as Promise<chrome.tabs.Tab[]> | void
    ));
}

function tabsCreate(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
    return chromeAsync<chrome.tabs.Tab>((callback) => (
        chrome.tabs.create(createProperties, callback) as unknown as Promise<chrome.tabs.Tab> | void
    ));
}

function tabsSendMessage(tabId: number, message: unknown): Promise<unknown> {
    return chromeAsync<unknown>((callback) => (
        chrome.tabs.sendMessage(tabId, message, callback) as unknown as Promise<unknown> | void
    ));
}

function permissionsContains(permissions: chrome.permissions.Permissions): Promise<boolean> {
    return chromeAsync<boolean>((callback) => (
        chrome.permissions.contains(permissions, callback) as unknown as Promise<boolean> | void
    ));
}

function permissionsRequest(permissions: chrome.permissions.Permissions): Promise<boolean> {
    return chromeAsync<boolean>((callback) => (
        chrome.permissions.request(permissions, callback) as unknown as Promise<boolean> | void
    ));
}

function scriptingExecuteScript(
    injection: chrome.scripting.ScriptInjection<unknown[], unknown>,
): Promise<chrome.scripting.InjectionResult[]> {
    return chromeAsync<chrome.scripting.InjectionResult[]>((callback) => (
        chrome.scripting.executeScript(injection, callback) as unknown as Promise<chrome.scripting.InjectionResult[]> | void
    ));
}

function scriptingInsertCSS(injection: chrome.scripting.CSSInjection): Promise<void> {
    return chromeAsync<void>((callback) => (
        chrome.scripting.insertCSS(injection, callback) as unknown as Promise<void> | void
    ));
}

function isSupportedTab(tab: chrome.tabs.Tab): boolean {
    if (!tab.url) return false;
    try {
        const url = new URL(tab.url);
        return (url.protocol === 'http:' || url.protocol === 'https:') && SUPPORTED_HOSTS.has(url.hostname);
    } catch {
        return false;
    }
}

function queueOpenSettingsWhenTabLoads(tabId: number): void {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(listener);
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        cleanup();
        void openSettingsInTab(tabId);
    };

    chrome.tabs.onUpdated.addListener(listener);
    timeoutId = setTimeout(cleanup, OPEN_SETTINGS_TIMEOUT_MS);
}
