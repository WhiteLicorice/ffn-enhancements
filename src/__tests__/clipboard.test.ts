import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeToClipboard } from '../utils/clipboard';

class MockClipboardItem {
    items: Record<string, Blob>;
    constructor(items: Record<string, Blob>) {
        this.items = items;
    }
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

    // ── Plain text ──

    it('writes plain text using writeText', async () => {
        const result = await writeToClipboard('Hello', false);
        expect(result).toBe(true);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello');
    });

    it('returns false when all text clipboard methods fail', async () => {
        (navigator.clipboard.write as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Not available')
        );
        (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('Permission denied')
        );
        const result = await writeToClipboard('Hello', false);
        expect(result).toBe(false);
    });

    // ── HTML — ClipboardItem API (primary) ──

    it('writes sanitized HTML via ClipboardItem API', async () => {
        const result = await writeToClipboard('<p onclick="x()">Hello</p><script>alert(1)</script>', true);
        expect(result).toBe(true);
        expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    });

    it('sanitizes HTML and plain text through ClipboardItem', async () => {
        const result = await writeToClipboard('<p onclick="x()">Hello</p><iframe src="https://evil.test"></iframe>', true);

        expect(result).toBe(true);
        const clipboardItem = (navigator.clipboard.write as ReturnType<typeof vi.fn>).mock.calls[0][0][0] as MockClipboardItem;
        await expect(clipboardItem.items['text/html'].text()).resolves.toBe('<p>Hello</p>');
        await expect(clipboardItem.items['text/plain'].text()).resolves.toBe('Hello');
    });

    it('falls back to execCommand when ClipboardItem fails', async () => {
        (navigator.clipboard.write as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Clipboard unavailable'));

        let capturedInnerHtml = '';
        document.execCommand = vi.fn().mockImplementation(() => {
            capturedInnerHtml = (document.body.lastElementChild as HTMLDivElement | null)?.innerHTML || '';
            return true;
        }) as unknown as typeof document.execCommand;

        const result = await writeToClipboard('<p onclick="x()">Hello</p><script>alert(1)</script>', true);

        expect(result).toBe(true);
        expect(capturedInnerHtml).toBe('<p>Hello</p>');
    });
});
