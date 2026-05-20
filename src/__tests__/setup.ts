import { vi } from 'vitest';

vi.mock('file-saver', () => ({
    saveAs: vi.fn(),
}));

function createMemoryStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() {
            return values.size;
        },
        clear() {
            values.clear();
        },
        getItem(key: string) {
            return values.has(key) ? values.get(key)! : null;
        },
        key(index: number) {
            return Array.from(values.keys())[index] ?? null;
        },
        removeItem(key: string) {
            values.delete(key);
        },
        setItem(key: string, value: string) {
            values.set(key, String(value));
        },
    };
}

function ensureLocalStorage(): void {
    const storage = createMemoryStorage();

    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: storage,
    });

    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: storage,
    });
}

ensureLocalStorage();
