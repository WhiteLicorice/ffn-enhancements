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
        const overlay = document.getElementById('ffne-paint-gate-overlay');
        expect(style?.parentElement).toBe(document.documentElement);
        expect(overlay?.parentElement).toBe(document.documentElement);
        expect(overlay?.getAttribute('style')).toContain('position:fixed !important');
        expect(overlay?.getAttribute('style')).toContain('background:#000 !important');
        expect(style?.textContent).toContain('opacity: 0 !important');
        expect(style?.textContent).toContain('html.ffne-paint-gated::before');
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
        expect(document.getElementById('ffne-paint-gate-overlay')).toBeNull();
        expect(document.documentElement.style.backgroundColor).toBe('');
    });

    it('restores a pre-existing inline root background on release', () => {
        resetDom();
        document.documentElement.style.backgroundColor = 'red';

        PaintGate.prime();
        PaintGate.release();

        expect(document.documentElement.style.backgroundColor).toBe('red');
    });

    it('does not overwrite an inline root background changed while gated', () => {
        resetDom();

        PaintGate.prime();
        document.documentElement.style.backgroundColor = 'rgb(10, 20, 30)';
        PaintGate.release();

        expect(document.documentElement.style.backgroundColor).toBe('rgb(10, 20, 30)');
    });

    it('fail-safe releases the gate after the timeout', () => {
        vi.useFakeTimers();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        resetDom();
        PaintGate.prime();

        vi.advanceTimersByTime(5000);

        expect(document.documentElement.classList.contains('ffne-paint-gated')).toBe(false);
        expect(document.getElementById('ffne-paint-gate-style')).toBeNull();
        expect(document.getElementById('ffne-paint-gate-overlay')).toBeNull();
        expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('releaseAfterPaint waits for two animation frames before releasing', () => {
        resetDom();
        PaintGate.prime();

        let nextFrameId = 1;
        const frameCallbacks = new Map<number, FrameRequestCallback>();

        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback): number => {
            const frameId = nextFrameId++;
            frameCallbacks.set(frameId, callback);
            return frameId;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId: number): void => {
            frameCallbacks.delete(frameId);
        });

        const releaseSpy = vi.spyOn(PaintGate, 'release');

        PaintGate.releaseAfterPaint();

        expect(releaseSpy).not.toHaveBeenCalled();
        frameCallbacks.get(1)?.(16);
        expect(releaseSpy).not.toHaveBeenCalled();
        frameCallbacks.get(2)?.(32);
        expect(releaseSpy).toHaveBeenCalledOnce();
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
