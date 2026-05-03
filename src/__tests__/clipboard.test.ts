import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeToClipboard } from '../utils/clipboard';

// Mock ClipboardItem — not available in jsdom.
class MockClipboardItem {
    constructor(_items: Record<string, Blob>) { }
}
(globalThis as any).ClipboardItem = MockClipboardItem;

describe('writeToClipboard', () => {
    const originalClipboard = globalThis.navigator.clipboard;

    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: {
                write: vi.fn().mockResolvedValue(undefined),
                writeText: vi.fn().mockResolvedValue(undefined),
            },
            writable: true,
            configurable: true,
        });
    });

    afterEach(() => {
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: originalClipboard,
            writable: true,
            configurable: true,
        });
    });

    it('writes plain text using writeText', async () => {
        const result = await writeToClipboard('Hello', false);
        expect(result).toBe(true);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello');
    });

    it('writes HTML using ClipboardItem API', async () => {
        const result = await writeToClipboard('<p>Hello</p>', true);
        expect(result).toBe(true);
        expect(navigator.clipboard.write).toHaveBeenCalled();
        const args = (navigator.clipboard.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(args[0]).toBeInstanceOf(MockClipboardItem);
    });

    it('falls back to writeText when ClipboardItem API fails (HTML path)', async () => {
        (navigator.clipboard.write as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Not available')
        );
        const result = await writeToClipboard('<p>Hello</p>', true);
        expect(result).toBe(true);
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('returns false when all clipboard methods fail', async () => {
        (navigator.clipboard.write as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Not available')
        );
        (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Permission denied')
        );
        const result = await writeToClipboard('Hello', false);
        expect(result).toBe(false);
    });
});
