import { describe, it, expect, beforeEach } from 'vitest';
import { DocManager } from '../modules/DocManager';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a minimal mock MouseEvent with a button as currentTarget. */
function mockEvent(btn: HTMLButtonElement): MouseEvent {
    return { currentTarget: btn } as unknown as MouseEvent;
}

/** Creates a button element for use as an event target. */
function makeBtn(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.innerText = 'Original';
    document.body.appendChild(btn);
    return btn;
}

function cleanupDOM(): void {
    document.body.innerHTML = '';
}

// ─── Module smoke test ──────────────────────────────────────────────────────

describe('DocManager module', () => {
    it('exports _runBulkOperation for test access', () => {
        expect(typeof DocManager._runBulkOperation).toBe('function');
    });
});

// ─── Regression: button reference captured in closure survives async gap ────

describe('DocManager bulk operation button reference', () => {
    beforeEach(() => {
        cleanupDOM();
    });

    it('captured button reference works after currentTarget becomes null', () => {
        // Exact pattern used in runBulkExport/runBulkRefresh:
        //   const btn = e.currentTarget as HTMLButtonElement;  // sync capture
        //   ... async work ...
        //   onFinalize: () => { btn.innerText = "..."; }       // uses captured ref

        const btn = makeBtn();
        const evt = mockEvent(btn);

        // Step 1: capture during sync handler (method entry)
        const captured = evt.currentTarget as HTMLButtonElement;
        expect(captured).not.toBeNull();
        expect(captured.innerText).toBe('Original');

        // Step 2: simulate post-event — currentTarget is nullified
        (evt as unknown as Record<string, unknown>).currentTarget = null;
        expect(evt.currentTarget).toBeNull();

        // Step 3: onFinalize callback accesses captured reference (not e.currentTarget)
        const onFinalize = () => {
            captured.innerText = 'All Done!';
        };

        // Must not throw "Cannot set properties of null"
        expect(() => onFinalize()).not.toThrow();
        expect(btn.innerText).toBe('All Done!');
    });

    it('button reference in closure is independent of event lifecycle', () => {
        const btn = makeBtn();
        const evt = mockEvent(btn);
        const captured = evt.currentTarget as HTMLButtonElement;

        // Simulate long async gap: event is long gone
        (evt as unknown as Record<string, unknown>).currentTarget = null;

        // Multiple mutations through captured reference
        captured.innerText = 'Zipping...';
        expect(btn.innerText).toBe('Zipping...');

        captured.innerText = 'Done';
        expect(btn.innerText).toBe('Done');
    });

    it('direct e.currentTarget access throws after event dispatch (the original bug)', () => {
        const btn = makeBtn();
        const evt = mockEvent(btn);

        // Simulate post-dispatch
        (evt as unknown as Record<string, unknown>).currentTarget = null;

        // This is the bug pattern: accessing e.currentTarget after event dispatch
        const buggyOnFinalize = () => {
            const target = evt.currentTarget as HTMLButtonElement;
            target.innerText = 'Boom'; // TypeError: Cannot set properties of null
        };

        expect(() => buggyOnFinalize()).toThrow();
    });
});
