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
                chrome.tabs.create({ url: message.url, active: message.active ?? true });
                sendResponse({ ok: true });
                return false;

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
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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

    const createdTab = await chrome.tabs.create({ url: FFN_HOME_URL, active: true });
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
        await chrome.tabs.sendMessage(tabId, { type: MessageType.OPEN_SETTINGS });
        return true;
    } catch {
        return false;
    }
}

async function injectContentScript(tabId: number): Promise<boolean> {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content/main.js'],
        });
        return true;
    } catch (err) {
        console.warn('FFN Enhancements could not inject content script for Settings.', err);
        return false;
    }
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
