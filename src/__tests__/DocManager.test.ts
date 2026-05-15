import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocManager } from '../modules/DocManager';
import type { IBulkItem } from '../interfaces/IBulkOperationConfig';

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
    document.head.innerHTML = '';
}

function makeItem(docName: string, docId: string): IBulkItem {
    return {
        docId,
        docName,
        title: docName,
        row: document.createElement('tr') as HTMLTableRowElement,
    };
}

function makeFile(name: string, relativePath: string, content: string = '# Title'): File {
    const file = new File([content], name, { type: 'text/markdown' });
    Object.defineProperty(file, 'webkitRelativePath', {
        value: relativePath,
        configurable: true,
    });
    return file;
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

describe('DocManager bulk import planner', () => {
    beforeEach(() => {
        cleanupDOM();
    });

    it('matches files by exact DocManager name plus .md', () => {
        const items = [
            makeItem('A0', '101'),
            makeItem('A0.md', '102'),
        ];
        const files = [
            makeFile('A0.md', 'Import/A0.md'),
            makeFile('A0.md.md', 'Import/A0.md.md'),
        ];

        const plan = DocManager._buildBulkImportPlan(files, items);

        expect(plan.matchedCount).toBe(2);
        expect(plan.missingCount).toBe(0);
        expect(plan.hasBlockingErrors).toBe(false);
        expect(plan.fileByDocId.get('101')?.name).toBe('A0.md');
        expect(plan.fileByDocId.get('102')?.name).toBe('A0.md.md');
    });

    it('blocks HTML and DOCX files in the selected directory', () => {
        const items = [makeItem('A0', '101')];
        const files = [
            makeFile('A0.md', 'Import/A0.md'),
            makeFile('A0.html', 'Import/A0.html'),
            makeFile('A0.htm', 'Import/A0.htm'),
            makeFile('A1.docx', 'Import/A1.docx'),
        ];

        const plan = DocManager._buildBulkImportPlan(files, items);

        expect(plan.matchedCount).toBe(1);
        expect(plan.hasBlockingErrors).toBe(true);
        expect(plan.blockedFiles).toEqual(['Import/A0.html', 'Import/A0.htm', 'Import/A1.docx']);
    });

    it('ignores unrelated files and nested Markdown files', () => {
        const items = [makeItem('A0', '101')];
        const files = [
            makeFile('A0.md', 'Import/Nested/A0.md'),
            makeFile('notes.txt', 'Import/notes.txt'),
        ];

        const plan = DocManager._buildBulkImportPlan(files, items);

        expect(plan.matchedCount).toBe(0);
        expect(plan.missingCount).toBe(1);
        expect(plan.ignoredFiles).toEqual(['Import/Nested/A0.md', 'Import/notes.txt']);
    });

    it('blocks duplicate Markdown filenames', () => {
        const items = [makeItem('A0', '101')];
        const files = [
            makeFile('A0.md', 'ImportA/A0.md'),
            makeFile('A0.md', 'ImportB/A0.md'),
        ];

        const plan = DocManager._buildBulkImportPlan(files, items);

        expect(plan.hasBlockingErrors).toBe(true);
        expect(plan.duplicateFileNames).toEqual(['A0.md']);
        expect(plan.rows[0].status).toBe('duplicate');
        expect(plan.fileByDocId.has('101')).toBe(false);
    });
});

describe('DocManager bulk import conversion', () => {
    it('converts Markdown to sanitized HTML', () => {
        const html = DocManager._markdownToImportHtml(
            '# Heading\n\n<script>alert(1)</script>\n\n**Bold**'
        );

        expect(html).toContain('<h1>Heading</h1>');
        expect(html).toContain('<strong>Bold</strong>');
        expect(html).not.toContain('<script>');
    });

    it('strips event attributes and dangerous URLs from imported HTML', () => {
        const html = DocManager._sanitizeImportHtml(
            '<p onclick="alert(1)">Text</p><a href="javascript:alert(1)">Bad</a>'
        );

        expect(html).toContain('<p>Text</p>');
        expect(html).toContain('<a>Bad</a>');
        expect(html).not.toContain('onclick');
        expect(html).not.toContain('javascript:');
    });
});

describe('DocManager advanced drawer', () => {
    beforeEach(() => {
        cleanupDOM();
        vi.restoreAllMocks();
    });

    it('opens a native advanced routines modal with all bulk actions', () => {
        DocManager.injectAdvancedDrawer();

        document.querySelector<HTMLButtonElement>('#ffne-docmanager-advanced-drawer button')?.click();

        expect(document.getElementById('ffne-docmanager-advanced-modal')).not.toBeNull();
        expect(document.querySelector('[data-ffne-action="bulk-export"]')).not.toBeNull();
        expect(document.querySelector('[data-ffne-action="bulk-refresh"]')).not.toBeNull();
        expect(document.querySelector('[data-ffne-action="bulk-import"]')).not.toBeNull();
    });

    it('routes Bulk Export and Bulk Refresh through existing handlers', () => {
        const exportSpy = vi.spyOn(DocManager, 'runBulkExport').mockResolvedValue(undefined);
        const refreshSpy = vi.spyOn(DocManager, 'runBulkRefresh').mockResolvedValue(undefined);

        DocManager.injectAdvancedDrawer();
        document.querySelector<HTMLButtonElement>('#ffne-docmanager-advanced-drawer button')?.click();
        document.querySelector<HTMLButtonElement>('[data-ffne-action="bulk-export"]')?.click();
        document.querySelector<HTMLButtonElement>('[data-ffne-action="bulk-refresh"]')?.click();

        expect(exportSpy).toHaveBeenCalledTimes(1);
        expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
});
