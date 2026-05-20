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
type RuntimeInstalledCallback = (details: chrome.runtime.InstalledDetails) => void;
type ScriptInjectionDetails = {
    target: { tabId: number };
    files?: string[];
    func?: () => void;
};
type CssInjectionDetails = {
    target: { tabId: number };
    files?: string[];
};

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
const runtimeInstalledListeners: RuntimeInstalledCallback[] = [];
const permissionAddedListeners: Array<(permissions: chrome.permissions.Permissions) => void> = [];
const permissionRemovedListeners: Array<(permissions: chrome.permissions.Permissions) => void> = [];

const tabsState = {
    nextTabId: 100,
    activeTab: { id: 1, url: 'https://www.fanfiction.net/' } as chrome.tabs.Tab,
    queryResponseTabs: null as chrome.tabs.Tab[] | null,
    queryCalls: [] as chrome.tabs.QueryInfo[],
    sendMessageRejectTabIds: new Set<number>(),
    sendMessageCalls: [] as Array<{ tabId: number; message: unknown }>,
    createCalls: [] as chrome.tabs.CreateProperties[],
    executeScriptCalls: [] as ScriptInjectionDetails[],
    /** Reject ALL executeScript calls for these tab IDs. */
    executeScriptRejectTabIds: new Set<number>(),
    /** Reject the first N executeScript calls for a tab (per-call counter). */
    executeScriptRejectCount: new Map<number, number>(),
};

const permissionsState = {
    grantedOrigins: new Set<string>(),
    requestResult: true,
    requestCalls: [] as chrome.permissions.Permissions[],
};

const scriptingState = {
    insertCSSCalls: [] as CssInjectionDetails[],
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
        onInstalled: {
            addListener: (cb: RuntimeInstalledCallback) => {
                runtimeInstalledListeners.push(cb);
            },
            removeListener: (cb: RuntimeInstalledCallback) => {
                const idx = runtimeInstalledListeners.indexOf(cb);
                if (idx !== -1) runtimeInstalledListeners.splice(idx, 1);
            },
        },
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
    permissions: {
        contains: async (permissions: chrome.permissions.Permissions) => {
            const origins = permissions.origins ?? [];
            return origins.every((origin) => permissionsState.grantedOrigins.has(origin));
        },
        request: async (permissions: chrome.permissions.Permissions) => {
            permissionsState.requestCalls.push(permissions);
            if (!permissionsState.requestResult) {
                return false;
            }

            for (const origin of permissions.origins ?? []) {
                permissionsState.grantedOrigins.add(origin);
            }
            return true;
        },
        onAdded: {
            addListener: (cb: (permissions: chrome.permissions.Permissions) => void) => {
                permissionAddedListeners.push(cb);
            },
            removeListener: (cb: (permissions: chrome.permissions.Permissions) => void) => {
                const idx = permissionAddedListeners.indexOf(cb);
                if (idx !== -1) permissionAddedListeners.splice(idx, 1);
            },
        },
        onRemoved: {
            addListener: (cb: (permissions: chrome.permissions.Permissions) => void) => {
                permissionRemovedListeners.push(cb);
            },
            removeListener: (cb: (permissions: chrome.permissions.Permissions) => void) => {
                const idx = permissionRemovedListeners.indexOf(cb);
                if (idx !== -1) permissionRemovedListeners.splice(idx, 1);
            },
        },
    },
    tabs: {
        query: async (queryInfo: chrome.tabs.QueryInfo) => {
            tabsState.queryCalls.push(queryInfo);
            if (queryInfo.active && queryInfo.currentWindow) {
                return [tabsState.activeTab];
            }
            return tabsState.queryResponseTabs ?? [tabsState.activeTab];
        },
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
    scripting: {
        insertCSS: async (details: CssInjectionDetails) => {
            scriptingState.insertCSSCalls.push(details);
        },
        executeScript: async (details: ScriptInjectionDetails) => {
            tabsState.executeScriptCalls.push(details);
            const tabId = details.target.tabId;

            // Per-call counter: reject the first N calls for this tab.
            const remaining = tabsState.executeScriptRejectCount.get(tabId) ?? 0;
            if (remaining > 0) {
                tabsState.executeScriptRejectCount.set(tabId, remaining - 1);
                throw new Error('Cannot access contents of the page.');
            }

            // Reject all calls for this tab.
            if (tabsState.executeScriptRejectTabIds.has(tabId)) {
                throw new Error('Cannot access contents of the page.');
            }

            tabsState.sendMessageRejectTabIds.delete(tabId);
            return [];
        },
    },
};

export const mockChromeStorage = storageInstance;

export const mockChromeAction = {
    get listenerCount(): number {
        return actionClickListeners.length;
    },
    async click(tab: chrome.tabs.Tab = tabsState.activeTab): Promise<void> {
        for (const listener of [...actionClickListeners]) {
            await listener(tab);
        }
    },
    _reset(): void {
        actionClickListeners.length = 0;
    },
};

export const mockChromePermissions = {
    state: permissionsState,
    grant(origins: string[]): void {
        for (const origin of origins) {
            permissionsState.grantedOrigins.add(origin);
        }
        for (const listener of [...permissionAddedListeners]) {
            listener({ origins });
        }
    },
    revoke(origins: string[]): void {
        for (const origin of origins) {
            permissionsState.grantedOrigins.delete(origin);
        }
        for (const listener of [...permissionRemovedListeners]) {
            listener({ origins });
        }
    },
    _reset(): void {
        permissionsState.grantedOrigins.clear();
        permissionsState.requestResult = true;
        permissionsState.requestCalls.length = 0;
        permissionAddedListeners.length = 0;
        permissionRemovedListeners.length = 0;
    },
};

export const mockChromeRuntimeOnInstalled = {
    fire(details: chrome.runtime.InstalledDetails): void {
        for (const listener of [...runtimeInstalledListeners]) {
            listener(details);
        }
    },
    _reset(): void {
        runtimeInstalledListeners.length = 0;
    },
};

export const mockChromeScripting = {
    get insertCSSCalls(): CssInjectionDetails[] {
        return scriptingState.insertCSSCalls;
    },
    _reset(): void {
        scriptingState.insertCSSCalls.length = 0;
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
        tabsState.queryResponseTabs = null;
        tabsState.queryCalls.length = 0;
        tabsState.sendMessageRejectTabIds.clear();
        tabsState.sendMessageCalls.length = 0;
        tabsState.createCalls.length = 0;
        tabsState.executeScriptCalls.length = 0;
        tabsState.executeScriptRejectTabIds.clear();
        tabsState.executeScriptRejectCount.clear();
        scriptingState.insertCSSCalls.length = 0;
        tabUpdatedListeners.length = 0;
        runtimeMessageListeners.length = 0;
    },
};
