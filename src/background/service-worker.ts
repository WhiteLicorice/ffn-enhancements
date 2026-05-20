// Service worker entry point for FFN Enhancements MV3 extension.
// Handles cross-origin fetch proxying and tab management on behalf of content scripts.

import { MessageType } from './message-types';
import type { BackgroundMessage, CrossOriginFetchMessage, CrossOriginFetchResponse } from './message-types';

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
actionApi.onClicked.addListener(async (tab) => {
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
    if (!(await injectContentScript(tabId))) {
        console.error('FFN-Enhancements: cannot dispatch settings — injection failed (step 2).');
        return false;
    }
    console.log('FFN-Enhancements: content script injected via activeTab (step 2).');

    // Step 3: Retry sendMessage. main.js bootstrap is synchronous, so by the
    //         time scripting.executeScript({files}) resolves, the OPEN_SETTINGS
    //         listener is registered.
    if (await sendOpenSettings(tabId)) {
        console.log('FFN-Enhancements: settings dispatched via sendMessage after inject (step 3).');
        return true;
    }

    console.error('FFN-Enhancements: sendMessage failed after injection — listener missing or dispatch race.');
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

async function injectContentScript(tabId: number): Promise<boolean> {
    try {
        await scriptingExecuteScript({
            target: { tabId },
            files: ['content/main.js'],
        });
        return true;
    } catch (err) {
        console.error('FFN-Enhancements: content script injection for Settings failed.', err);
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

function scriptingExecuteScript(
    injection: chrome.scripting.ScriptInjection<unknown[], unknown>,
): Promise<chrome.scripting.InjectionResult[]> {
    return chromeAsync<chrome.scripting.InjectionResult[]>((callback) => (
        chrome.scripting.executeScript(injection, callback) as unknown as Promise<chrome.scripting.InjectionResult[]> | void
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
