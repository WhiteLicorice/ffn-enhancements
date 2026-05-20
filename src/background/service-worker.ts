// Service worker entry point for FFN Enhancements MV3 extension.
// Handles cross-origin fetch proxying and tab management on behalf of content scripts.

import { MessageType } from './message-types';
import type { BackgroundMessage, CrossOriginFetchMessage, CrossOriginFetchResponse } from './message-types';

const FFN_HOME_URL = 'https://www.fanfiction.net/';
const OPEN_SETTINGS_TIMEOUT_MS = 30_000;
const SUPPORTED_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net', 'archiveofourown.org']);

console.log('FFN Enhancements service worker loaded.');

// Clicking the extension icon opens the Settings modal on the active tab.
chrome.action.onClicked.addListener(async (tab) => {
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
    if (await sendOpenSettings(tabId)) return true;
    if (!await injectContentScript(tabId)) return false;
    return sendOpenSettings(tabId);
}

async function sendOpenSettings(tabId: number): Promise<boolean> {
    try {
        await tabsSendMessage(tabId, { type: MessageType.OPEN_SETTINGS });
        return true;
    } catch {
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
        console.warn('FFN Enhancements could not inject content script for Settings.', err);
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
