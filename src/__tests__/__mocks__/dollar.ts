// Mock for the '$' virtual module (vite-plugin-monkey)
import { vi } from 'vitest';

export const GM_getValue = vi.fn(() => undefined);
export const GM_setValue = vi.fn();
export const GM_deleteValue = vi.fn();
export const GM_addValueChangeListener = vi.fn();
export const GM_registerMenuCommand = vi.fn(() => '');
export const GM_unregisterMenuCommand = vi.fn();
export const GM_xmlhttpRequest = vi.fn();
export const GM_openInTab = vi.fn();
export const GM_setClipboard = vi.fn();
export const GM_cookie = {
    list: vi.fn((_details: any, callback: any) => {
        if (callback) callback([], null);
    }),
    set: vi.fn(),
    delete: vi.fn(),
};
