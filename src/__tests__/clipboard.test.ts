import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeToClipboard } from '../utils/clipboard';

// Mock ClipboardItem — not available in jsdom.
class MockClipboardItem {
    constructor(_items: Record<string, Blob>) { }
}
(globalThis as any).ClipboardItem = MockClipboardItem;

describe('writeToClipboard', () => {
    const originalClipboard = globalThis.navigator.clipboard;
    const originalExecCommand = document.execCommand;

    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: {
                write: vi.fn().mockResolvedValue(undefined),
                writeText: vi.fn().mockResolvedValue(undefined),
            },
            writable: true,
            configurable: true,
        });
        // jsdom execCommand('copy') returns true by default.
        // Override to false so fallback tests can verify behavior.
        document.execCommand = vi.fn().mockReturnValue(false) as unknown as typeof document.execCommand;
    });

    afterEach(() => {
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: originalClipboard,
            writable: true,
            configurable: true,
        });
        document.execCommand = originalExecCommand;
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

    it('falls back to contentEditable div + execCommand when ClipboardItem fails for HTML', async () => {
        (navigator.clipboard.write as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Not available')
        );
        // Make execCommand succeed for this test.
        (document.execCommand as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
        const result = await writeToClipboard('<p>Hello</p>', true);
        expect(result).toBe(true);
        expect(document.execCommand).toHaveBeenCalledWith('copy');
    });

    it('returns false when all clipboard methods fail (plain text path)', async () => {
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
