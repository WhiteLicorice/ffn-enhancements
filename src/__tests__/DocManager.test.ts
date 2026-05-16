import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DocManager } from '../modules/DocManager';
import type { IBulkItem } from '../interfaces/IBulkOperationConfig';
import type { IAo3Chapter } from '../interfaces/IAo3Migration';
import { Ao3Service } from '../services/Ao3Service';
import { DocFetchService } from '../services/DocFetchService';
import { SettingsManager } from '../modules/SettingsManager';
import { Core } from '../modules/Core';
import { DocManagerDelegate } from '../delegates/DocManagerDelegate';

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

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
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

function makeSelectedFile(name: string, content: string = '# Title'): File {
    const file = new File([content], name, { type: 'text/markdown' });
    Object.defineProperty(file, 'webkitRelativePath', {
        value: '',
        configurable: true,
    });
    return file;
}

function makeAo3Chapter(chapterNumber: number): IAo3Chapter {
    return {
        workId: '77945481',
        chapterId: `900${chapterNumber}`,
        chapterNumber,
        label: `Chapter ${chapterNumber}: Title ${chapterNumber}`,
        title: `Title ${chapterNumber}`,
        readerUrl: `https://archiveofourown.org/works/77945481/chapters/900${chapterNumber}`,
        editUrl: `https://archiveofourown.org/works/77945481/chapters/900${chapterNumber}/edit`,
    };
}

function mountDocManagerItems(items: Array<{ docId: string; docName: string }>): void {
    document.body.innerHTML = `
        <table id="gui_table1">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Life</th>
                </tr>
            </thead>
            <tbody>
                ${items.map(({ docId, docName }) => `
                    <tr>
                        <td><a href="https://www.fanfiction.net/docs/edit.php?docid=${docId}">Edit</a></td>
                        <td>${docName}</td>
                        <td>123 days</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
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
        expect(plan.missingCount).toBe(0);
        expect(plan.ignoredFiles).toEqual(['Import/Nested/A0.md', 'Import/notes.txt']);
    });

    it('shows selected Markdown files with no DocManager match as missing', () => {
        const items = [makeItem('A0', '101')];
        const files = [
            makeFile('A0.md', 'Import/A0.md'),
            makeFile('Missing.md', 'Import/Missing.md'),
        ];

        const plan = DocManager._buildBulkImportPlan(files, items);

        expect(plan.matchedCount).toBe(1);
        expect(plan.missingCount).toBe(1);
        expect(plan.rows.map(row => row.status)).toEqual(['matched', 'missing']);
        expect(plan.rows[1]).toMatchObject({
            docId: '',
            docName: 'Missing',
            expectedFileName: 'Missing.md',
            status: 'missing',
        });
        expect(plan.fileByDocId.get('101')?.name).toBe('A0.md');
    });

    it('matches individually selected files without directory paths', () => {
        const items = [makeItem('A0', '101')];
        const files = [
            makeSelectedFile('A0.md'),
            makeSelectedFile('Missing.md'),
        ];

        const plan = DocManager._buildBulkImportPlan(files, items);

        expect(plan.matchedCount).toBe(1);
        expect(plan.missingCount).toBe(1);
        expect(plan.ignoredFiles).toEqual([]);
        expect(plan.rows.map(row => row.expectedFileName)).toEqual(['A0.md', 'Missing.md']);
        expect(plan.fileByDocId.get('101')?.name).toBe('A0.md');
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

describe('DocManager bulk import modal', () => {
    beforeEach(() => {
        cleanupDOM();
    });

    afterEach(() => {
        DocManager.closeBulkImportModal();
        cleanupDOM();
    });

    it('offers separate folder and file pickers', () => {
        DocManager.openBulkImportModal();

        const folderButton = document.getElementById('ffne-dm-browse-folder');
        const filesButton = document.getElementById('ffne-dm-browse-files');
        const folderInput = document.getElementById('ffne-dm-import-folder-input') as HTMLInputElement | null;
        const filesInput = document.getElementById('ffne-dm-import-files-input') as HTMLInputElement | null;
        const results = document.getElementById('ffne-dm-import-results') as HTMLElement | null;

        expect(folderButton?.textContent).toBe('Browse Folder');
        expect(filesButton?.textContent).toBe('Browse Files');
        expect(folderInput?.type).toBe('file');
        expect(folderInput?.multiple).toBe(true);
        expect(folderInput?.hasAttribute('webkitdirectory')).toBe(true);
        expect(filesInput?.type).toBe('file');
        expect(filesInput?.multiple).toBe(true);
        expect(filesInput?.hasAttribute('webkitdirectory')).toBe(false);
        expect(results?.hidden).toBe(true);
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

        const drawerButton = document.querySelector<HTMLButtonElement>('#ffne-docmanager-advanced-drawer button');
        expect(drawerButton?.classList.contains('ffne-dm-drawer-pull')).toBe(true);
        expect(drawerButton?.getAttribute('aria-label')).toBe('Open advanced document routines');
        expect(drawerButton?.textContent?.trim()).toBe('');
        expect(drawerButton?.querySelector('.ffne-dm-drawer-grabber')).not.toBeNull();
        expect(drawerButton?.querySelector('.ffne-dm-drawer-chevron')).not.toBeNull();

        drawerButton?.click();

        expect(document.getElementById('ffne-docmanager-advanced-modal')).not.toBeNull();
        expect(document.querySelector('[data-ffne-action="bulk-export"]')).not.toBeNull();
        expect(document.querySelector('[data-ffne-action="bulk-refresh"]')).not.toBeNull();
        expect(document.querySelector('[data-ffne-action="bulk-import"]')).not.toBeNull();
        expect(document.querySelector('[data-ffne-action="bulk-migrate-ao3"]')).not.toBeNull();
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

describe('DocManager AO3 migration mapping', () => {
    it('renders one mapping row per AO3 chapter and auto-maps numbered docs to matching chapters', () => {
        const rows = DocManager._createAo3MigrationRows(
            [makeItem('P1', '1'), makeItem('P44', '44'), makeItem('Intro', '99')],
            [makeAo3Chapter(1), makeAo3Chapter(44)],
        );

        expect(rows).toHaveLength(2);
        expect(rows[0].chapter.chapterNumber).toBe(1);
        expect(rows[0]).toMatchObject({
            mappingSource: 'auto',
            status: 'mapped',
        });
        expect(rows[0].selectedSourceItem?.docName).toBe('P1');
        expect(rows[1].chapter.chapterNumber).toBe(44);
        expect(rows[1].selectedSourceItem?.docName).toBe('P44');
    });

    it('manual source doc mappings override auto-map and unmapped AO3 chapters are skipped', () => {
        const chapters = [makeAo3Chapter(1), makeAo3Chapter(2), makeAo3Chapter(3)];
        const sourceItems = [makeItem('P1', '1'), makeItem('P2', '2')];
        const rows = DocManager._createAo3MigrationRows(
            sourceItems,
            chapters,
        );

        DocManager._setManualAo3SourceSelection(rows, sourceItems, 0, sourceItems[1].docId);
        DocManager._setManualAo3SourceSelection(rows, sourceItems, 1, '');
        const plan = DocManager._buildAo3MigrationPlan('https://archiveofourown.org/works/77945481', chapters, rows, false);

        expect(plan.rows[0]).toMatchObject({
            mappingSource: 'manual',
            status: 'mapped',
        });
        expect(plan.rows[0].selectedSourceItem?.docName).toBe('P2');
        expect(plan.rows[1].status).toBe('skipped');
        expect(plan.mappedCount).toBe(1);
        expect(plan.skippedCount).toBe(2);
    });

    it('autofills source docs backward and forward from a manual numbered selection', () => {
        const chapters = [makeAo3Chapter(1), makeAo3Chapter(2), makeAo3Chapter(3), makeAo3Chapter(4), makeAo3Chapter(5)];
        const sourceItems = [
            makeItem('StoryName001', '1'),
            makeItem('StoryName002', '2'),
            makeItem('StoryName003', '3'),
            makeItem('StoryName004', '4'),
            makeItem('StoryName005', '5'),
        ];
        const rows = DocManager._createAo3MigrationRows([], chapters);

        DocManager._setManualAo3SourceSelection(rows, sourceItems, 4, '5');

        expect(rows.map(row => row.selectedSourceItem?.docName)).toEqual([
            'StoryName001',
            'StoryName002',
            'StoryName003',
            'StoryName004',
            'StoryName005',
        ]);
        expect(rows[0].mappingSource).toBe('autofill');
        expect(rows[4].mappingSource).toBe('manual');
    });

    it('does not autofill AO3 rows more than once after they were autofilled', () => {
        const chapters = [makeAo3Chapter(1), makeAo3Chapter(2), makeAo3Chapter(3), makeAo3Chapter(4)];
        const sourceItems = [
            makeItem('P1', '1'),
            makeItem('P2', '2'),
            makeItem('P3', '3'),
            makeItem('P4', '4'),
            makeItem('Alt1', '11'),
            makeItem('Alt2', '12'),
            makeItem('Alt3', '13'),
            makeItem('Alt4', '14'),
        ];
        const rows = DocManager._createAo3MigrationRows([], chapters);

        DocManager._setManualAo3SourceSelection(rows, sourceItems, 3, '4');
        DocManager._setManualAo3SourceSelection(rows, sourceItems, 1, '12');

        expect(rows.map(row => row.selectedSourceItem?.docName)).toEqual([
            'P1',
            'Alt2',
            'P3',
            'P4',
        ]);
        expect(rows[0].hasBeenAutofilled).toBe(true);
        expect(rows[2].hasBeenAutofilled).toBe(true);
    });

    it('blocks duplicate source doc mappings during validation', () => {
        const chapters = [makeAo3Chapter(1), makeAo3Chapter(2)];
        const sourceItems = [makeItem('P1', '1'), makeItem('P2', '2')];
        const rows = DocManager._createAo3MigrationRows(
            sourceItems,
            chapters,
        );

        DocManager._setManualAo3SourceSelection(rows, sourceItems, 1, sourceItems[0].docId);
        const plan = DocManager._buildAo3MigrationPlan('https://archiveofourown.org/works/77945481', chapters, rows, false);

        expect(plan.hasBlockingErrors).toBe(true);
        expect(plan.duplicateSourceDocIds).toEqual([sourceItems[0].docId]);
        expect(plan.rows.map(row => row.status)).toEqual(['duplicate', 'duplicate']);
    });
});

describe('DocManager AO3 migration modal', () => {
    beforeEach(() => {
        cleanupDOM();
        Core.activeDelegate = DocManagerDelegate;
        vi.restoreAllMocks();
    });

    afterEach(() => {
        DocManager.closeAo3MigrationModal();
        Core.activeDelegate = null;
        cleanupDOM();
    });

    it('loads AO3 chapters and renders one mapping row per visible doc', async () => {
        mountDocManagerItems([
            { docId: '100', docName: 'P1' },
            { docId: '101', docName: 'P2' },
        ]);
        vi.spyOn(Ao3Service, 'fetchChapterIndex').mockResolvedValue({
            ok: true,
            chapters: [makeAo3Chapter(1), makeAo3Chapter(2)],
        });

        DocManager.openAo3MigrationModal();
        const input = document.getElementById('ffne-dm-ao3-work-url') as HTMLInputElement;
        const stripInput = document.getElementById('ffne-dm-ao3-strip-marker') as HTMLInputElement;
        input.value = 'https://archiveofourown.org/works/77945481';
        stripInput.value = 'Notes:';
        document.getElementById('ffne-dm-ao3-load')?.dispatchEvent(new MouseEvent('click'));
        await flushMicrotasks();

        const rows = document.querySelectorAll('#ffne-dm-ao3-mappings tbody tr');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('Chapter 1');
        expect((rows[0].querySelector('select') as HTMLSelectElement).value).toBe('100');
        expect((rows[1].querySelector('select') as HTMLSelectElement).value).toBe('101');
        expect(document.getElementById('ffne-dm-ao3-summary')?.textContent).toContain('Notes:');
    });
});

describe('DocManager AO3 migration execution', () => {
    beforeEach(() => {
        cleanupDOM();
        Core.activeDelegate = DocManagerDelegate;
        vi.useFakeTimers();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        Core.activeDelegate = null;
        vi.useRealTimers();
        cleanupDOM();
    });

    async function runAo3MigrationWithPlan(plan: ReturnType<typeof DocManager._buildAo3MigrationPlan>) {
        const sourceRows = new Map(
            plan.rows
                .map(row => row.selectedSourceItem)
                .filter((item): item is IBulkItem => !!item)
                .map(item => [item.docId, item.row] as [string, HTMLTableRowElement])
        );
        sourceRows.forEach(row => document.body.appendChild(row));
        const btn = makeBtn();
        const status = document.createElement('div');
        const results = document.createElement('div');
        document.body.append(status, results);

        const promise = DocManager.runBulkAo3Migration(mockEvent(btn), plan, status, results);
        await vi.runAllTimersAsync();
        await promise;
        await vi.runAllTimersAsync();

        return { btn, status, results };
    }

    it('blocks execution when duplicate source doc mappings exist', async () => {
        const chapters = [makeAo3Chapter(1), makeAo3Chapter(2)];
        const sourceItems = [makeItem('P1', '1'), makeItem('P2', '2')];
        const rows = DocManager._createAo3MigrationRows(
            sourceItems,
            chapters,
        );
        DocManager._setManualAo3SourceSelection(rows, sourceItems, 1, sourceItems[0].docId);
        const plan = DocManager._buildAo3MigrationPlan('https://archiveofourown.org/works/77945481', chapters, rows, false);
        const fetchSpy = vi.spyOn(DocFetchService, 'fetchPrivateDocAsHtml');
        const updateSpy = vi.spyOn(Ao3Service, 'updateChapterContent');

        const { status } = await runAo3MigrationWithPlan(plan);

        expect(status.textContent).toContain('duplicate source doc mappings');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('blocks AO3 POSTs when the source doc is empty', async () => {
        const chapters = [makeAo3Chapter(1)];
        const plan = DocManager._buildAo3MigrationPlan(
            'https://archiveofourown.org/works/77945481',
            chapters,
            DocManager._createAo3MigrationRows([makeItem('P1', '1')], chapters),
            false,
        );
        vi.spyOn(DocFetchService, 'fetchPrivateDocAsHtml').mockResolvedValue('');
        const updateSpy = vi.spyOn(Ao3Service, 'updateChapterContent');

        const { status, results } = await runAo3MigrationWithPlan(plan);

        expect(status.textContent).toContain('No AO3 chapters migrated');
        expect(results.innerHTML).toContain('Source document is empty.');
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('forces AO3 compatibility transforms even when the global setting is off', async () => {
        const chapters = [makeAo3Chapter(1)];
        const plan = DocManager._buildAo3MigrationPlan(
            'https://archiveofourown.org/works/77945481',
            chapters,
            DocManager._createAo3MigrationRows([makeItem('P1', '1')], chapters),
            false,
        );
        vi.spyOn(DocFetchService, 'fetchPrivateDocAsHtml').mockResolvedValue("<center><p style='text-align: centre;'>Centered</p></center>");
        vi.spyOn(SettingsManager, 'get').mockImplementation((key: any) => {
            if (key === 'ao3HtmlCompatibility' || key === 'appendSeparator') return false;
            if (key === 'bulkExportDelayMs' || key === 'bulkCooldownMs' || key === 'bulkRetryDelayMs') return 0;
            return 0;
        });
        const updateSpy = vi.spyOn(Ao3Service, 'updateChapterContent').mockResolvedValue({ ok: true });

        await runAo3MigrationWithPlan(plan);

        expect(updateSpy).toHaveBeenCalledWith(
            chapters[0],
            '<div align="center"><p align="center">Centered</p></div>'
        );
    });

    it('applies optional linebreak conversion only when checked', async () => {
        const chapters = [makeAo3Chapter(1)];
        vi.spyOn(DocFetchService, 'fetchPrivateDocAsHtml').mockResolvedValue('<p>Line 1\nLine 2</p>');
        vi.spyOn(SettingsManager, 'get').mockImplementation((key: any) => {
            if (key === 'ao3HtmlCompatibility' || key === 'appendSeparator') return false;
            if (key === 'bulkExportDelayMs' || key === 'bulkCooldownMs' || key === 'bulkRetryDelayMs') return 0;
            return 0;
        });
        const updateSpy = vi.spyOn(Ao3Service, 'updateChapterContent').mockResolvedValue({ ok: true });

        const rowsA = DocManager._createAo3MigrationRows([makeItem('P1', '1')], chapters);
        const rowsB = DocManager._createAo3MigrationRows([makeItem('P1', '1')], chapters);
        const withoutLinebreaks = DocManager._buildAo3MigrationPlan('https://archiveofourown.org/works/77945481', chapters, rowsA, false);
        const withLinebreaks = DocManager._buildAo3MigrationPlan('https://archiveofourown.org/works/77945481', chapters, rowsB, true);

        await runAo3MigrationWithPlan(withoutLinebreaks);
        await runAo3MigrationWithPlan(withLinebreaks);

        expect(updateSpy.mock.calls[0][1]).toBe('<p>Line 1\nLine 2</p>');
        expect(updateSpy.mock.calls[1][1]).toBe('<p>Line 1<br>Line 2</p>');
    });

    it('strips notes from source docs before AO3 updates', async () => {
        const chapters = [makeAo3Chapter(1)];
        const plan = DocManager._buildAo3MigrationPlan(
            'https://archiveofourown.org/works/77945481',
            chapters,
            DocManager._createAo3MigrationRows([makeItem('P1', '1')], chapters),
            false,
            'Notes:',
        );
        vi.spyOn(DocFetchService, 'fetchPrivateDocAsHtml').mockResolvedValue('<p>Body</p>\nNotes:\n<p>Remove this</p>');
        vi.spyOn(SettingsManager, 'get').mockImplementation((key: any) => {
            if (key === 'ao3HtmlCompatibility' || key === 'appendSeparator') return false;
            if (key === 'bulkExportDelayMs' || key === 'bulkCooldownMs' || key === 'bulkRetryDelayMs') return 0;
            return 0;
        });
        const updateSpy = vi.spyOn(Ao3Service, 'updateChapterContent').mockResolvedValue({ ok: true });

        await runAo3MigrationWithPlan(plan);

        expect(updateSpy).toHaveBeenCalledWith(chapters[0], '<p>Body</p>\n');
    });

    it('does not strip note markers unless they are standalone on one line', async () => {
        const chapters = [makeAo3Chapter(1)];
        const plan = DocManager._buildAo3MigrationPlan(
            'https://archiveofourown.org/works/77945481',
            chapters,
            DocManager._createAo3MigrationRows([makeItem('P1', '1')], chapters),
            false,
            'Notes:',
        );
        vi.spyOn(DocFetchService, 'fetchPrivateDocAsHtml').mockResolvedValue('<p>Body</p>Notes:\n<p>Keep this</p>');
        vi.spyOn(SettingsManager, 'get').mockImplementation((key: any) => {
            if (key === 'ao3HtmlCompatibility' || key === 'appendSeparator') return false;
            if (key === 'bulkExportDelayMs' || key === 'bulkCooldownMs' || key === 'bulkRetryDelayMs') return 0;
            return 0;
        });
        const updateSpy = vi.spyOn(Ao3Service, 'updateChapterContent').mockResolvedValue({ ok: true });

        await runAo3MigrationWithPlan(plan);

        expect(updateSpy).toHaveBeenCalledWith(chapters[0], '<p>Body</p>Notes:\n<p>Keep this</p>');
    });

    it('blocks AO3 POSTs when stripping notes leaves no source content', async () => {
        const chapters = [makeAo3Chapter(1)];
        const plan = DocManager._buildAo3MigrationPlan(
            'https://archiveofourown.org/works/77945481',
            chapters,
            DocManager._createAo3MigrationRows([makeItem('P1', '1')], chapters),
            false,
            'Notes:',
        );
        vi.spyOn(DocFetchService, 'fetchPrivateDocAsHtml').mockResolvedValue('Notes:\nOnly notes');
        const updateSpy = vi.spyOn(Ao3Service, 'updateChapterContent');

        const { status, results } = await runAo3MigrationWithPlan(plan);

        expect(status.textContent).toContain('No AO3 chapters migrated');
        expect(results.innerHTML).toContain('Source document is empty after stripping notes.');
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('renders a failure table for failed AO3 migrations', async () => {
        const chapters = [makeAo3Chapter(1)];
        const plan = DocManager._buildAo3MigrationPlan(
            'https://archiveofourown.org/works/77945481',
            chapters,
            DocManager._createAo3MigrationRows([makeItem('P1', '1')], chapters),
            false,
        );
        vi.spyOn(DocFetchService, 'fetchPrivateDocAsHtml').mockResolvedValue('<p>Ready</p>');
        vi.spyOn(Ao3Service, 'updateChapterContent').mockResolvedValue({
            ok: false,
            reason: 'AO3 rejected the update.',
        });

        const { results } = await runAo3MigrationWithPlan(plan);

        expect(results.innerHTML).toContain('Failed AO3 Migrations');
        expect(results.innerHTML).toContain('P1');
        expect(results.innerHTML).toContain('Chapter 1');
        expect(results.innerHTML).toContain('AO3 rejected the update.');
    });
});
