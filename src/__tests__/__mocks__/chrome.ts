// Mock for chrome.* extension APIs used by platform and background tests.

type StorageChangeCallback = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;
type ActionClickCallback = (tab: chrome.tabs.Tab) => void | Promise<void>;
type TabUpdatedCallback = (
    tabId: number,
    changeInfo: { status?: string },
    tab: chrome.tabs.Tab,
) => void;
type RuntimeMessageCallback = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
) => boolean | void;

class MockStorageArea {
    private _store = new Map<string, unknown>();
    private _listeners: StorageChangeCallback[] = [];

    get(
        _keys?: string | string[] | Record<string, unknown> | null,
    ): Promise<Record<string, unknown>> {
        const result: Record<string, unknown> = {};
        for (const [key, value] of this._store) {
            result[key] = value;
        }
        return Promise.resolve(result);
    }

    set(items: Record<string, unknown>): Promise<void> {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [key, value] of Object.entries(items)) {
            const oldValue = this._store.get(key);
            this._store.set(key, value);
            changes[key] = { oldValue, newValue: value };
        }
        this._fireOnChanged(changes);
        return Promise.resolve();
    }

    remove(keys: string | string[]): Promise<void> {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const key of keyList) {
            const oldValue = this._store.get(key);
            this._store.delete(key);
            changes[key] = { oldValue, newValue: undefined as unknown };
        }
        this._fireOnChanged(changes);
        return Promise.resolve();
    }

    readonly onChanged = {
        addListener: (cb: StorageChangeCallback) => {
            this._listeners.push(cb);
        },
        removeListener: (cb: StorageChangeCallback) => {
            const idx = this._listeners.indexOf(cb);
            if (idx !== -1) this._listeners.splice(idx, 1);
        },
        hasListener: (cb: StorageChangeCallback) => {
            return this._listeners.includes(cb);
        },
    };

    private _fireOnChanged(changes: Record<string, chrome.storage.StorageChange>): void {
        if (this._listeners.length === 0) return;
        for (const listener of [...this._listeners]) {
            try {
                listener(changes, 'local');
            } catch {
                // Real chrome.storage.onChanged does not propagate listener errors.
            }
        }
    }

    _reset(): void {
        this._store.clear();
        this._listeners.length = 0;
    }
}

const storageInstance = new MockStorageArea();
const actionClickListeners: ActionClickCallback[] = [];
const tabUpdatedListeners: TabUpdatedCallback[] = [];
const runtimeMessageListeners: RuntimeMessageCallback[] = [];

const tabsState = {
    nextTabId: 100,
    activeTab: { id: 1, url: 'https://www.fanfiction.net/' } as chrome.tabs.Tab,
    sendMessageRejectTabIds: new Set<number>(),
    sendMessageCalls: [] as Array<{ tabId: number; message: unknown }>,
    createCalls: [] as chrome.tabs.CreateProperties[],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = {
    storage: {
        local: storageInstance,
        onChanged: storageInstance.onChanged,
    },
    action: {
        onClicked: {
            addListener: (cb: ActionClickCallback) => {
                actionClickListeners.push(cb);
            },
            removeListener: (cb: ActionClickCallback) => {
                const idx = actionClickListeners.indexOf(cb);
                if (idx !== -1) actionClickListeners.splice(idx, 1);
            },
        },
    },
    runtime: {
        sendMessage: async (message: unknown) => ({ ok: true, message }),
        onMessage: {
            addListener: (cb: RuntimeMessageCallback) => {
                runtimeMessageListeners.push(cb);
            },
            removeListener: (cb: RuntimeMessageCallback) => {
                const idx = runtimeMessageListeners.indexOf(cb);
                if (idx !== -1) runtimeMessageListeners.splice(idx, 1);
            },
        },
    },
    tabs: {
        query: async () => [tabsState.activeTab],
        sendMessage: async (tabId: number, message: unknown) => {
            tabsState.sendMessageCalls.push({ tabId, message });
            if (tabsState.sendMessageRejectTabIds.has(tabId)) {
                throw new Error('Receiving end does not exist.');
            }
            return { ok: true };
        },
        create: async (properties: chrome.tabs.CreateProperties) => {
            tabsState.createCalls.push(properties);
            return {
                id: tabsState.nextTabId++,
                url: properties.url,
                active: properties.active,
            } as chrome.tabs.Tab;
        },
        onUpdated: {
            addListener: (cb: TabUpdatedCallback) => {
                tabUpdatedListeners.push(cb);
            },
            removeListener: (cb: TabUpdatedCallback) => {
                const idx = tabUpdatedListeners.indexOf(cb);
                if (idx !== -1) tabUpdatedListeners.splice(idx, 1);
            },
        },
    },
};

export const mockChromeStorage = storageInstance;

export const mockChromeAction = {
    async click(tab: chrome.tabs.Tab = tabsState.activeTab): Promise<void> {
        for (const listener of [...actionClickListeners]) {
            await listener(tab);
        }
    },
    _reset(): void {
        actionClickListeners.length = 0;
    },
};

export const mockChromeTabs = {
    state: tabsState,
    triggerUpdated(tabId: number, changeInfo: { status?: string }): void {
        const lastCreateCall = tabsState.createCalls[tabsState.createCalls.length - 1];
        const tab = { id: tabId, url: lastCreateCall?.url } as chrome.tabs.Tab;
        for (const listener of [...tabUpdatedListeners]) {
            listener(tabId, changeInfo, tab);
        }
    },
    _reset(): void {
        tabsState.nextTabId = 100;
        tabsState.activeTab = { id: 1, url: 'https://www.fanfiction.net/' } as chrome.tabs.Tab;
        tabsState.sendMessageRejectTabIds.clear();
        tabsState.sendMessageCalls.length = 0;
        tabsState.createCalls.length = 0;
        tabUpdatedListeners.length = 0;
        runtimeMessageListeners.length = 0;
    },
};
