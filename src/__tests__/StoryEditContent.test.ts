import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryEditContent } from '../modules/StoryEditContent';
import { DocFetchService } from '../services/DocFetchService';
import type {
    IStoryEditContentChapter,
    IStoryEditContentDoc,
    IStoryEditContentMappingRow,
} from '../interfaces/IStoryEditContent';

function cleanupDOM(): void {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
}

function makeBtn(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.innerText = 'Run Bulk Replace';
    document.body.appendChild(btn);
    return btn;
}

function mockEvent(btn: HTMLButtonElement): MouseEvent {
    return { currentTarget: btn } as unknown as MouseEvent;
}

function makeChapter(chapterNumber: number): IStoryEditContentChapter {
    return {
        storyTextId: String(1000 + chapterNumber),
        chapterNumber,
        chapterLabel: `Chapter ${chapterNumber}`,
        published: true,
        row: null,
    };
}

function makeDocs(prefix: string, start: number, end: number): IStoryEditContentDoc[] {
    const docs: IStoryEditContentDoc[] = [];
    for (let current = start; current <= end; current++) {
        docs.push({
            docId: `${prefix}-${current}`,
            docName: `${prefix}${String(current).padStart(3, '0')}`,
        });
    }
    return docs;
}

function makeMappings(chapterCount: number): IStoryEditContentMappingRow[] {
    return StoryEditContent._createMappingRows(
        Array.from({ length: chapterCount }, (_value, index) => makeChapter(index + 1))
    );
}

describe('StoryEditContent parsing', () => {
    beforeEach(() => {
        cleanupDOM();
    });

    afterEach(() => {
        cleanupDOM();
    });

    it('parses published chapters and document options from FFN-like HTML', () => {
        document.body.innerHTML = `
            <form action="/story/story_edit_content.php">
                <input type="hidden" name="action" value="replace">
                <select name="storytextid">
                    <option value="">Select Chapter</option>
                    <option value="101">Chapter 1 - One</option>
                    <option value="102">Chapter 2 - Two</option>
                    <option value="103">Chapter 3 - Three</option>
                </select>
                <select name="docid">
                    <option value="">Select Doc</option>
                    <option value="201">StoryName001</option>
                    <option value="202">StoryName002</option>
                </select>
                <input type="submit" value="Replace">
            </form>
            <table>
                <tbody>
                    <tr data-storytextid="101"><td>Chapter 1</td><td>Published</td></tr>
                    <tr data-storytextid="102"><td>Chapter 2</td><td>Draft</td></tr>
                    <tr data-storytextid="103"><td>Chapter 3</td><td>Published</td></tr>
                </tbody>
            </table>
        `;

        const chapters = StoryEditContent._parsePublishedChapters(
            document.querySelector('select[name="storytextid"]'),
            Array.from(document.querySelectorAll('tbody tr')),
        );
        const docs = StoryEditContent._parseDocOptions(document.querySelector('select[name="docid"]'));

        expect(chapters.map(chapter => chapter.storyTextId)).toEqual(['101', '103']);
        expect(chapters.map(chapter => chapter.chapterNumber)).toEqual([1, 3]);
        expect(docs).toEqual([
            { docId: '201', docName: 'StoryName001' },
            { docId: '202', docName: 'StoryName002' },
        ]);
    });
});

describe('StoryEditContent mapping state', () => {
    it('tracks manual mappings and skips unmapped rows', () => {
        const mappings = makeMappings(3);
        const docs = [
            { docId: 'plain-1', docName: 'Standalone Intro' },
            { docId: 'plain-2', docName: 'Standalone Middle' },
            { docId: 'plain-3', docName: 'Standalone Finale' },
        ];

        StoryEditContent._setManualDocSelection(mappings, docs, 0, 'plain-1');
        const plan = StoryEditContent._buildMappingPlan(mappings);

        expect(plan.mappedCount).toBe(1);
        expect(plan.skippedCount).toBe(2);
        expect(plan.rows[0]).toMatchObject({
            selectedDocName: 'Standalone Intro',
            source: 'manual',
            status: 'mapped',
        });
        expect(plan.rows[1].status).toBe('skipped');
        expect(plan.rows[2].status).toBe('skipped');
    });

    it('autofills backward and forward from a middle selection with zero padding', () => {
        const mappings = makeMappings(7);
        const docs = makeDocs('StoryName', 1, 7);

        StoryEditContent._setManualDocSelection(mappings, docs, 4, 'StoryName-5');

        expect(mappings.map(row => row.selectedDocName)).toEqual([
            'StoryName001',
            'StoryName002',
            'StoryName003',
            'StoryName004',
            'StoryName005',
            'StoryName006',
            'StoryName007',
        ]);
        expect(mappings[0].source).toBe('autofill');
        expect(mappings[4].source).toBe('manual');
        expect(mappings[6].source).toBe('autofill');
    });

    it('does not autofill rows more than once after they were autofilled', () => {
        const mappings = makeMappings(4);
        const docs = [
            ...makeDocs('StoryName', 1, 4),
            ...makeDocs('AltName', 1, 4),
        ];

        StoryEditContent._setManualDocSelection(mappings, docs, 1, 'StoryName-2');
        StoryEditContent._setManualDocSelection(mappings, docs, 2, 'AltName-3');

        expect(mappings.map(row => row.selectedDocName)).toEqual([
            'StoryName001',
            'StoryName002',
            'AltName003',
            'StoryName004',
        ]);
        expect(mappings[0].hasBeenAutofilled).toBe(true);
        expect(mappings[3].hasBeenAutofilled).toBe(true);
    });

    it('autofilled rows do not cascade new autofill chains', () => {
        const mappings = makeMappings(4);
        const docs = makeDocs('StoryName', 2, 4);

        StoryEditContent._setManualDocSelection(mappings, docs, 1, 'StoryName-2');

        expect(mappings.map(row => row.selectedDocName)).toEqual([
            '',
            'StoryName002',
            'StoryName003',
            'StoryName004',
        ]);
        expect(mappings[0].source).toBe('unmapped');
    });

    it('manual selections override earlier autofill', () => {
        const mappings = makeMappings(4);
        const docs = [
            ...makeDocs('StoryName', 1, 4),
            ...makeDocs('AltName', 1, 4),
        ];

        StoryEditContent._setManualDocSelection(mappings, docs, 1, 'StoryName-2');
        StoryEditContent._setManualDocSelection(mappings, docs, 0, 'AltName-1');
        StoryEditContent._setManualDocSelection(mappings, docs, 2, 'AltName-3');

        expect(mappings[0]).toMatchObject({
            selectedDocName: 'AltName001',
            source: 'manual',
        });
        expect(mappings[1].selectedDocName).toBe('StoryName002');
        expect(mappings[3].selectedDocName).toBe('StoryName004');
    });

    it('blocks duplicate doc mappings during validation', () => {
        const mappings = makeMappings(2);
        const docs = makeDocs('StoryName', 1, 2);

        StoryEditContent._setManualDocSelection(mappings, docs, 0, 'StoryName-1');
        StoryEditContent._setManualDocSelection(mappings, docs, 1, 'StoryName-1');
        const plan = StoryEditContent._buildMappingPlan(mappings);

        expect(plan.hasBlockingErrors).toBe(true);
        expect(plan.duplicateDocIds).toEqual(['StoryName-1']);
        expect(plan.rows.map(row => row.status)).toEqual(['duplicate', 'duplicate']);
    });
});

describe('StoryEditContent bulk replace execution', () => {
    beforeEach(() => {
        cleanupDOM();
        vi.useFakeTimers();
        vi.restoreAllMocks();
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        StoryEditContent._state = null;
        vi.useRealTimers();
        vi.unstubAllGlobals();
        cleanupDOM();
    });

    async function runBulkReplaceWithState(mappings: IStoryEditContentMappingRow[], docs: IStoryEditContentDoc[]) {
        const btn = makeBtn();
        const status = document.createElement('div');
        const results = document.createElement('div');
        document.body.append(status, results);

        StoryEditContent._state = {
            actionUrl: '/story/story_edit_content.php',
            chapters: mappings.map(row => row.chapter),
            docs,
            mappings,
        };

        const plan = StoryEditContent._buildMappingPlan(mappings);
        const promise = StoryEditContent.runBulkReplace(mockEvent(btn), plan, status, results);
        await vi.runAllTimersAsync();
        await promise;
        await vi.runAllTimersAsync();

        return { btn, status, results, plan };
    }

    it('blocks execution when duplicate doc mappings exist', async () => {
        const mappings = makeMappings(2);
        const docs = makeDocs('StoryName', 1, 2);
        StoryEditContent._setManualDocSelection(mappings, docs, 0, 'StoryName-1');
        StoryEditContent._setManualDocSelection(mappings, docs, 1, 'StoryName-1');
        const validateSpy = vi.spyOn(DocFetchService, 'validatePrivateDocHasContentWithResult');

        const { status } = await runBulkReplaceWithState(mappings, docs);

        expect(status.textContent).toContain('duplicate doc mappings');
        expect(validateSpy).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('blocks chapter replace POSTs when the source document is empty', async () => {
        const mappings = makeMappings(1);
        const docs = makeDocs('StoryName', 1, 1);
        StoryEditContent._setManualDocSelection(mappings, docs, 0, 'StoryName-1');

        vi.spyOn(DocFetchService, 'validatePrivateDocHasContentWithResult').mockResolvedValue({
            ok: false,
            reason: 'Source document is empty.',
        });

        const { status, results } = await runBulkReplaceWithState(mappings, docs);

        expect(status.textContent).toContain('No chapters were replaced');
        expect(results.innerHTML).toContain('Source document is empty.');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('posts the expected replace body and treats a successful response as success', async () => {
        const mappings = makeMappings(1);
        const docs = makeDocs('StoryName', 1, 1);
        StoryEditContent._setManualDocSelection(mappings, docs, 0, 'StoryName-1');

        vi.spyOn(DocFetchService, 'validatePrivateDocHasContentWithResult').mockResolvedValue({ ok: true });
        vi.mocked(globalThis.fetch).mockResolvedValue({
            ok: true,
            text: async () => '<html><body>Success</body></html>',
        } as Response);

        const { status } = await runBulkReplaceWithState(mappings, docs);

        expect(globalThis.fetch).toHaveBeenCalledWith('/story/story_edit_content.php', expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin',
            body: 'storytextid=1001&docid=StoryName-1&action=replace',
        }));
        expect(status.textContent).toContain('Replaced all 1 chapter');
    });

    it('renders a failure table for failed replacements', async () => {
        const mappings = makeMappings(1);
        const docs = makeDocs('StoryName', 1, 1);
        StoryEditContent._setManualDocSelection(mappings, docs, 0, 'StoryName-1');

        vi.spyOn(DocFetchService, 'validatePrivateDocHasContentWithResult').mockResolvedValue({ ok: true });
        vi.mocked(globalThis.fetch).mockResolvedValue({
            ok: false,
            status: 500,
            text: async () => 'Server error',
        } as Response);

        const { results } = await runBulkReplaceWithState(mappings, docs);

        expect(results.innerHTML).toContain('Failed Replacements');
        expect(results.innerHTML).toContain('Chapter 1');
        expect(results.innerHTML).toContain('StoryName001');
        expect(results.innerHTML).toContain('HTTP 500');
    });

    it('renders the failure table helper output', () => {
        const container = document.createElement('div');

        StoryEditContent._renderFailureTable(container, [{
            chapterLabel: 'Chapter 7',
            docName: 'StoryName007',
            reason: 'Replace failed after retry.',
        }]);

        expect(container.hidden).toBe(false);
        expect(container.innerHTML).toContain('Failed Replacements');
        expect(container.innerHTML).toContain('Chapter 7');
        expect(container.innerHTML).toContain('StoryName007');
    });
});
