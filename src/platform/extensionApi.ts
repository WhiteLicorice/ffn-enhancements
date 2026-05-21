type StorageGetKeys = string | string[] | Record<string, unknown> | null | undefined;
type RuntimeLastError = { message?: string } | undefined;

export type ExtensionRuntimeMessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
export type ExtensionRuntimeMessageSender = Parameters<ExtensionRuntimeMessageListener>[1];
export type ExtensionStorageChange = chrome.storage.StorageChange;
export type ExtensionStorageChanges = Record<string, ExtensionStorageChange>;
export type ExtensionStorageChangedListener = (
    changes: ExtensionStorageChanges,
    areaName: string
) => void;

interface PromiseNamespaceApi {
    runtime: {
        sendMessage(message: unknown): Promise<unknown>;
        onMessage: {
            addListener(listener: ExtensionRuntimeMessageListener): void;
            removeListener(listener: ExtensionRuntimeMessageListener): void;
        };
    };
    storage: {
        local: {
            get(keys?: StorageGetKeys): Promise<Record<string, unknown>>;
            set(items: Record<string, unknown>): Promise<void>;
            remove(keys: string | string[]): Promise<void>;
        };
        onChanged: {
            addListener(listener: ExtensionStorageChangedListener): void;
            removeListener(listener: ExtensionStorageChangedListener): void;
        };
    };
    permissions: {
        contains(permissions: chrome.permissions.Permissions): Promise<boolean>;
        request(permissions: chrome.permissions.Permissions): Promise<boolean>;
    };
    tabs: {
        create(properties: chrome.tabs.CreateProperties): Promise<unknown>;
    };
}

interface CallbackNamespaceApi {
    runtime: {
        sendMessage(message: unknown, callback?: (response: unknown) => void): void;
        lastError?: RuntimeLastError;
        onMessage: {
            addListener(listener: ExtensionRuntimeMessageListener): void;
            removeListener(listener: ExtensionRuntimeMessageListener): void;
        };
    };
    storage: {
        local: {
            get(keys: StorageGetKeys, callback: (items: Record<string, unknown>) => void): void;
            set(items: Record<string, unknown>, callback: () => void): void;
            remove(keys: string | string[], callback: () => void): void;
        };
        onChanged: {
            addListener(listener: ExtensionStorageChangedListener): void;
            removeListener(listener: ExtensionStorageChangedListener): void;
        };
    };
    permissions: {
        contains(permissions: chrome.permissions.Permissions, callback: (result: boolean) => void): void;
        request(permissions: chrome.permissions.Permissions, callback: (result: boolean) => void): void;
    };
    tabs: {
        create(properties: chrome.tabs.CreateProperties, callback: (tab: unknown) => void): void;
    };
}

function getBrowserApi(): PromiseNamespaceApi | undefined {
    return (globalThis as typeof globalThis & { browser?: PromiseNamespaceApi }).browser;
}

function getChromeApi(): CallbackNamespaceApi {
    const chromeApi = (globalThis as typeof globalThis & { chrome?: CallbackNamespaceApi }).chrome;
    if (!chromeApi) {
        throw new Error('Extension API is unavailable.');
    }
    return chromeApi;
}

function getEventApi(): Pick<PromiseNamespaceApi, 'runtime' | 'storage'> | Pick<CallbackNamespaceApi, 'runtime' | 'storage'> {
    return getBrowserApi() ?? getChromeApi();
}

function getLastError(): RuntimeLastError {
    return getChromeApi().runtime.lastError;
}

function toExtensionError(lastError: RuntimeLastError): Error {
    return new Error(lastError?.message || 'Extension API call failed.');
}

function callChromeApi<T>(invoke: (callback: (result: T) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        try {
            invoke((result: T) => {
                const lastError = getLastError();
                if (lastError) {
                    reject(toExtensionError(lastError));
                    return;
                }
                resolve(result);
            });
        } catch (error) {
            reject(error);
        }
    });
}

export const extensionApi = {
    runtime: {
        sendMessage<TResponse = unknown>(message: unknown): Promise<TResponse> {
            const browserApi = getBrowserApi();
            if (browserApi) {
                return browserApi.runtime.sendMessage(message) as Promise<TResponse>;
            }

            const chromeApi = getChromeApi();
            return callChromeApi<TResponse>((callback) => {
                chromeApi.runtime.sendMessage(message, (response) => {
                    callback(response as TResponse);
                });
            });
        },
        onMessage: {
            addListener(listener: ExtensionRuntimeMessageListener): void {
                getEventApi().runtime.onMessage.addListener(listener);
            },
            removeListener(listener: ExtensionRuntimeMessageListener): void {
                getEventApi().runtime.onMessage.removeListener(listener);
            },
        },
    },
    storage: {
        local: {
            get(keys?: StorageGetKeys): Promise<Record<string, unknown>> {
                const browserApi = getBrowserApi();
                if (browserApi) {
                    return browserApi.storage.local.get(keys);
                }

                const chromeApi = getChromeApi();
                return callChromeApi<Record<string, unknown>>((callback) => {
                    chromeApi.storage.local.get(keys, callback);
                });
            },
            set(items: Record<string, unknown>): Promise<void> {
                const browserApi = getBrowserApi();
                if (browserApi) {
                    return browserApi.storage.local.set(items);
                }

                const chromeApi = getChromeApi();
                return callChromeApi<void>((callback) => {
                    chromeApi.storage.local.set(items, callback);
                });
            },
            remove(keys: string | string[]): Promise<void> {
                const browserApi = getBrowserApi();
                if (browserApi) {
                    return browserApi.storage.local.remove(keys);
                }

                const chromeApi = getChromeApi();
                return callChromeApi<void>((callback) => {
                    chromeApi.storage.local.remove(keys, callback);
                });
            },
        },
        onChanged: {
            addListener(listener: ExtensionStorageChangedListener): void {
                getEventApi().storage.onChanged.addListener(listener);
            },
            removeListener(listener: ExtensionStorageChangedListener): void {
                getEventApi().storage.onChanged.removeListener(listener);
            },
        },
    },
    permissions: {
        contains(permissions: chrome.permissions.Permissions): Promise<boolean> {
            const browserApi = getBrowserApi();
            if (browserApi) {
                return browserApi.permissions.contains(permissions);
            }

            const chromeApi = getChromeApi();
            return callChromeApi<boolean>((callback) => {
                chromeApi.permissions.contains(permissions, callback);
            });
        },
        request(permissions: chrome.permissions.Permissions): Promise<boolean> {
            const browserApi = getBrowserApi();
            if (browserApi) {
                return browserApi.permissions.request(permissions);
            }

            const chromeApi = getChromeApi();
            return callChromeApi<boolean>((callback) => {
                chromeApi.permissions.request(permissions, callback);
            });
        },
    },
    tabs: {
        create(properties: chrome.tabs.CreateProperties): Promise<unknown> {
            const browserApi = getBrowserApi();
            if (browserApi) {
                return browserApi.tabs.create(properties);
            }

            const chromeApi = getChromeApi();
            return callChromeApi<unknown>((callback) => {
                chromeApi.tabs.create(properties, callback);
            });
        },
    },
};
