import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaintGate } from '../modules/PaintGate';

declare const jsdom: { reconfigure(options: { url: string }): void };

function resetDom(html: string = '<head></head><body></body>'): void {
    document.documentElement.innerHTML = html;
    document.documentElement.className = '';
    document.documentElement.style.backgroundColor = '';
}

describe('PaintGate', () => {
    afterEach(() => {
        PaintGate.release();
        vi.useRealTimers();
        vi.restoreAllMocks();
        resetDom();
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/' });
    });

    it('gates before head exists and migrates the style into head later', async () => {
        jsdom.reconfigure({ url: 'https://www.fanfiction.net/s/1/1/Test' });
        resetDom('<body></body>');
        document.head?.remove();

        PaintGate.prime();

        const style = document.getElementById('ffne-paint-gate-style');
        expect(style?.parentElement).toBe(document.documentElement);
        expect(document.documentElement.classList.contains('ffne-paint-gated')).toBe(true);
        expect(document.documentElement.style.backgroundColor).toBe('rgb(0, 0, 0)');

        const head = document.createElement('head');
        document.documentElement.insertBefore(head, document.body);

        await vi.waitFor(() => {
            expect(style?.parentElement).toBe(document.head);
        });
    });

    it('release removes the gate class, style, and inline background', () => {
        resetDom();

        PaintGate.prime();
        PaintGate.release();

        expect(document.documentElement.classList.contains('ffne-paint-gated')).toBe(false);
        expect(document.getElementById('ffne-paint-gate-style')).toBeNull();
        expect(document.documentElement.style.backgroundColor).toBe('');
    });

    it('fail-safe releases the gate after the timeout', () => {
        vi.useFakeTimers();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        resetDom();
        PaintGate.prime();

        vi.advanceTimersByTime(5000);

        expect(document.documentElement.classList.contains('ffne-paint-gated')).toBe(false);
        expect(document.getElementById('ffne-paint-gate-style')).toBeNull();
        expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('does not gate AO3 pages', () => {
        resetDom();
        jsdom.reconfigure({ url: 'https://archiveofourown.org/works/1' });

        PaintGate.prime();

        expect(document.documentElement.classList.contains('ffne-paint-gated')).toBe(false);
        expect(document.getElementById('ffne-paint-gate-style')).toBeNull();
        expect(document.documentElement.style.backgroundColor).toBe('');
    });
});
