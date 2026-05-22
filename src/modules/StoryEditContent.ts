import { Elements } from '../enums/Elements';
import {
    IStoryEditContentChapter,
    IStoryEditContentDoc,
    IStoryEditContentFailure,
    IStoryEditContentMappingRow,
    IStoryEditContentPlan,
    STORY_EDIT_CONTENT_CHAPTER_ID_ATTR,
} from '../interfaces/IStoryEditContent';
import { IBulkOperationConfig } from '../interfaces/IBulkOperationConfig';
import { Core } from './Core';
import { DocFetchService } from '../services/DocFetchService';
import { StoryReplaceService } from '../services/StoryReplaceService';
import { runBulkOperation } from '../utils/runBulkOperation';
import { markFfneUiRoot } from '../utils/ffneUi';
import { injectStyleOnce } from '../utils/injectStyleOnce';
import { SettingsManager } from './SettingsManager';
import storyEditContentStyles from '../styles/story-edit-content.css?raw';

const BULK_REPLACE_BUTTON_ID = 'ffne-story-bulk-replace-btn';
const BULK_REPLACE_MODAL_ID = 'ffne-story-bulk-replace-modal';
const BULK_REPLACE_STYLE_ID = 'ffne-story-bulk-replace-style';

interface StoryEditContentState {
    actionUrl: string;
    chapters: IStoryEditContentChapter[];
    docs: IStoryEditContentDoc[];
    mappings: IStoryEditContentMappingRow[];
}

interface ParsedSemanticDocName {
    prefix: string;
    number: number;
    padding: number;
}

function _normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function _parseFfnOptionName(value: string): string {
    return _normalizeText(value)
        .replace(/^\d+\.\s*/, '')
        .replace(/\s*\([\d,]+\)\s*$/, '')
        .trim();
}

function _escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _extractChapterNumber(label: string, fallbackNumber: number): number {
    const normalized = _normalizeText(label);
    const chapterMatch = normalized.match(/(?:chapter|ch\.?|#)\s*(\d+)/i) || normalized.match(/^(\d+)\b/);
    if (chapterMatch) {
        const parsed = Number.parseInt(chapterMatch[1], 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return fallbackNumber;
}

function _extractStoryTextId(row: HTMLElement): string {
    return row.getAttribute(STORY_EDIT_CONTENT_CHAPTER_ID_ATTR) || '';
}

function _parsePublishedChapters(
    chapterSelect: HTMLSelectElement | null,
    chapterRows: HTMLElement[] = [],
): IStoryEditContentChapter[] {
    if (!chapterSelect) return [];

    const options = Array.from(chapterSelect.options)
        .filter((option) => {
            const value = option.value.trim();
            return !!value && value !== '0';
        })
        .map((option, index) => ({
            storyTextId: option.value.trim(),
            chapterNumber: _extractChapterNumber(option.textContent || option.label || '', index + 1),
            chapterLabel: _normalizeText(option.textContent || option.label || `Chapter ${index + 1}`),
        }));

    const publishedById = new Set<string>();
    const publishedIndices: number[] = [];
    let sawStatusMarkers = false;

    chapterRows.forEach((row, index) => {
        const text = _normalizeText(row.textContent || '');
        if (!text) return;

        const isDraft = /unpublished|draft|not published/i.test(text);
        const isPublished = /published/i.test(text) && !isDraft;
        if (/published|draft|unpublished/i.test(text)) {
            sawStatusMarkers = true;
        }
        if (!isPublished) return;

        const storyTextId = _extractStoryTextId(row);
        if (storyTextId) {
            publishedById.add(storyTextId);
        } else {
            publishedIndices.push(index);
        }
    });

    if (publishedById.size > 0) {
        const rowById = new Map(chapterRows.map(row => [_extractStoryTextId(row), row as HTMLTableRowElement]));
        return options
            .filter(option => publishedById.has(option.storyTextId))
            .map(option => ({
                ...option,
                published: true,
                row: rowById.get(option.storyTextId) || null,
            }));
    }

    if (sawStatusMarkers && publishedIndices.length > 0) {
        return publishedIndices
            .map(index => options[index])
            .filter((option): option is typeof options[number] => !!option)
            .map(option => ({
                ...option,
                published: true,
                row: chapterRows[options.indexOf(option)] as HTMLTableRowElement | null,
            }));
    }

    return options.map(option => ({
        ...option,
        published: true,
        row: null,
    }));
}

function _parseDocOptions(docSelect: HTMLSelectElement | null): IStoryEditContentDoc[] {
    if (!docSelect) return [];

    const seen = new Set<string>();
    const docs: IStoryEditContentDoc[] = [];
    for (const option of Array.from(docSelect.options)) {
        const docId = option.value.trim();
        const docName = _parseFfnOptionName(option.textContent || option.label || '');
        if (!docId || docId === '0' || !docName || seen.has(docId)) continue;
        seen.add(docId);
        docs.push({ docId, docName });
    }
    return docs;
}

function _createMappingRows(chapters: IStoryEditContentChapter[]): IStoryEditContentMappingRow[] {
    return chapters.map(chapter => ({
        chapter,
        selectedDocId: '',
        selectedDocName: '',
        source: 'unmapped',
        hasBeenAutofilled: false,
        status: 'unmapped',
        modalRow: null,
    }));
}

function _parseSemanticDocName(docName: string): ParsedSemanticDocName | null {
    const match = docName.match(/^(.*?)(\d+)$/);
    if (!match) return null;

    return {
        prefix: match[1],
        number: Number.parseInt(match[2], 10),
        padding: match[2].length,
    };
}

function _buildDocMaps(docs: IStoryEditContentDoc[]) {
    const bySemanticNumber = new Map<string, IStoryEditContentDoc | null>();

    docs.forEach(doc => {
        const parsed = _parseSemanticDocName(doc.docName);
        if (!parsed) return;

        const key = `${parsed.prefix}\u0000${parsed.number}`;
        if (bySemanticNumber.has(key)) {
            bySemanticNumber.set(key, null);
        } else {
            bySemanticNumber.set(key, doc);
        }
    });

    return {
        byId: new Map(docs.map(doc => [doc.docId, doc])),
        byName: new Map(docs.map(doc => [doc.docName, doc])),
        bySemanticNumber,
    };
}

function _getSemanticDocMatch(
    byName: Map<string, IStoryEditContentDoc>,
    bySemanticNumber: Map<string, IStoryEditContentDoc | null>,
    prefix: string,
    candidateNumber: number,
    padding: number,
): IStoryEditContentDoc | null {
    const paddedName = `${prefix}${String(candidateNumber).padStart(padding, '0')}`;
    const exactMatch = byName.get(paddedName);
    if (exactMatch) return exactMatch;

    return bySemanticNumber.get(`${prefix}\u0000${candidateNumber}`) || null;
}

function _applySemanticAutofill(
    mappings: IStoryEditContentMappingRow[],
    docs: IStoryEditContentDoc[],
    anchorIndex: number,
    selectedDocId: string,
): IStoryEditContentMappingRow[] {
    const log = Core.getLogger('story-edit-content', '_applySemanticAutofill');
    const anchor = mappings[anchorIndex];
    if (!anchor || !selectedDocId) return mappings;

    const { byId, byName, bySemanticNumber } = _buildDocMaps(docs);
    const anchorDoc = byId.get(selectedDocId);
    const parsed = anchorDoc ? _parseSemanticDocName(anchorDoc.docName) : null;
    if (!anchorDoc || !parsed) {
        log(`No semantic doc suffix found for selected doc "${anchorDoc?.docName || selectedDocId}".`);
        return mappings;
    }

    let appliedCount = 0;
    for (let index = 0; index < mappings.length; index++) {
        if (index === anchorIndex) continue;

        const row = mappings[index];
        if (row.source === 'manual' || row.hasBeenAutofilled) continue;

        const offset = row.chapter.chapterNumber - anchor.chapter.chapterNumber;
        const candidateNumber = parsed.number + offset;
        if (!Number.isFinite(candidateNumber) || candidateNumber <= 0) continue;

        const candidateDoc = _getSemanticDocMatch(
            byName,
            bySemanticNumber,
            parsed.prefix,
            candidateNumber,
            parsed.padding,
        );
        if (!candidateDoc) continue;

        row.selectedDocId = candidateDoc.docId;
        row.selectedDocName = candidateDoc.docName;
        row.source = 'autofill';
        row.hasBeenAutofilled = true;
        row.status = 'mapped';
        appliedCount++;
    }

    log(`Autofill from "${anchorDoc.docName}" applied to ${appliedCount} row(s).`, {
        anchorIndex,
        anchorChapter: anchor.chapter.chapterNumber,
    });

    return mappings;
}

function _setManualDocSelection(
    mappings: IStoryEditContentMappingRow[],
    docs: IStoryEditContentDoc[],
    rowIndex: number,
    docId: string,
): IStoryEditContentMappingRow[] {
    const row = mappings[rowIndex];
    if (!row) return mappings;

    const { byId } = _buildDocMaps(docs);
    const doc = byId.get(docId);
    row.selectedDocId = doc?.docId || '';
    row.selectedDocName = doc?.docName || '';
    row.source = doc ? 'manual' : 'unmapped';
    row.status = doc ? 'mapped' : 'unmapped';

    const log = Core.getLogger('story-edit-content', '_setManualDocSelection');
    if (doc && SettingsManager.get('bulkReplaceAutofill')) {
        log(`Manual selection "${doc.docName}" on row ${rowIndex}; running semantic autofill.`);
        _applySemanticAutofill(mappings, docs, rowIndex, doc.docId);
    } else if (doc) {
        log(`Manual selection "${doc.docName}" on row ${rowIndex}; semantic autofill disabled.`);
    } else {
        log(`Row ${rowIndex} unmapped by manual selection.`);
    }

    return mappings;
}

function _buildMappingPlan(mappings: IStoryEditContentMappingRow[]): IStoryEditContentPlan {
    const counts = new Map<string, number>();
    let mappedCount = 0;
    let skippedCount = 0;

    mappings.forEach(row => {
        if (!row.selectedDocId) {
            skippedCount++;
            row.status = 'skipped';
            return;
        }

        mappedCount++;
        counts.set(row.selectedDocId, (counts.get(row.selectedDocId) || 0) + 1);
        row.status = 'mapped';
    });

    const duplicateDocIds = Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([docId]) => docId);
    const duplicateSet = new Set(duplicateDocIds);

    mappings.forEach(row => {
        if (row.selectedDocId && duplicateSet.has(row.selectedDocId)) {
            row.status = 'duplicate';
        }
    });

    return {
        rows: mappings,
        mappedCount,
        skippedCount,
        duplicateDocIds,
        hasBlockingErrors: duplicateDocIds.length > 0,
    };
}

function _renderFailureTable(
    container: HTMLElement | null | undefined,
    failures: IStoryEditContentFailure[],
    onRetry?: () => void,
): void {
    if (!container) return;

    if (failures.length === 0) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }

    const rowsHtml = failures.map(failure => `
        <tr>
            <td>${_escapeHtml(failure.chapterLabel)}</td>
            <td>${_escapeHtml(failure.docName)}</td>
            <td>${_escapeHtml(failure.reason)}</td>
        </tr>
    `).join('');

    const retryHtml = onRetry
        ? `<div class="ffne-story-bulk-retry-wrap"><button type="button" id="ffne-story-bulk-retry" class="ffne-story-bulk-btn">Retry Failed</button></div>`
        : '';

    container.hidden = false;
    // eslint-disable-next-line no-unsanitized/property -- rowsHtml values all escaped via _escapeHtml
    container.innerHTML = `
        <div class="ffne-story-bulk-results-title">Failed Replacements</div>
        <table class="ffne-story-bulk-table" contenteditable="false">
            <thead>
                <tr>
                    <th>Chapter</th>
                    <th>Source Doc</th>
                    <th>Reason</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        ${retryHtml}
    `;

    if (onRetry) {
        container.querySelector<HTMLButtonElement>('#ffne-story-bulk-retry')
            ?.addEventListener('click', onRetry);
    }
}

export const StoryEditContent = {
    MODULE_NAME: 'story-edit-content',
    _state: null as StoryEditContentState | null,
    _escHandler: null as ((e: KeyboardEvent) => void) | null,

    init: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'init');
        Core.onDomReady(() => {
            log('Initializing StoryEditContent hooks.');
            const form = Core.getElement(Elements.STORY_EDIT_REPLACE_FORM) as HTMLFormElement | null;
            if (!form) {
                log('Replace form not found.');
                return;
            }
            this.injectBulkReplaceButton(form);
            log('StoryEditContent hooks initialized.');
        });
    },

    injectBulkReplaceButton: function (form: HTMLFormElement) {
        if (document.getElementById(BULK_REPLACE_BUTTON_ID)) return;
        const log = Core.getLogger(this.MODULE_NAME, 'injectBulkReplaceButton');

        this._injectStyles();

        const trigger = document.createElement('a');
        trigger.id = BULK_REPLACE_BUTTON_ID;
        trigger.href = '#';
        trigger.textContent = 'Bulk Replace';
        trigger.addEventListener('click', event => {
            event.preventDefault();
            this.openBulkReplaceModal();
        });

        const replaceToggle = Core.getElement(Elements.STORY_EDIT_REPLACE_TOGGLE) as HTMLAnchorElement | null;
        if (replaceToggle?.parentElement) {
            const separator = document.createTextNode(' | ');
            replaceToggle.after(separator, trigger);
            log('Bulk Replace link inserted next to visible Replace/Update toggle.');
            return;
        }

        const replaceControl = Core.getElement(Elements.STORY_EDIT_REPLACE_SUBMIT) as HTMLElement | null;
        if (replaceControl) {
            replaceControl.insertAdjacentElement('afterend', trigger);
            log('Bulk Replace link inserted after native replace submit control.');
        } else {
            form.appendChild(trigger);
            log('Bulk Replace link appended to native replace form.');
        }
    },

    openBulkReplaceModal: function () {
        if (document.getElementById(BULK_REPLACE_MODAL_ID)) return;
        const log = Core.getLogger(this.MODULE_NAME, 'openBulkReplaceModal');

        const replaceForm = Core.getElement(Elements.STORY_EDIT_REPLACE_FORM) as HTMLFormElement | null;
        const chapterSelect = Core.getElement(Elements.STORY_EDIT_CHAPTER_SELECT) as HTMLSelectElement | null;
        const docSelect = Core.getElement(Elements.STORY_EDIT_DOC_SELECT) as HTMLSelectElement | null;
        const chapterRows = Core.getElements(Elements.STORY_EDIT_CHAPTER_ROWS);

        const chapters = _parsePublishedChapters(chapterSelect, chapterRows);
        const docs = _parseDocOptions(docSelect);
        if (!replaceForm || chapters.length === 0 || docs.length === 0) {
            log('Bulk Replace modal blocked by missing page data.', {
                hasReplaceForm: !!replaceForm,
                chapterCount: chapters.length,
                docCount: docs.length,
            });
            return;
        }
        log(`Opening Bulk Replace modal for ${chapters.length} chapter(s) and ${docs.length} doc(s).`);

        // GOTCHA: replaceForm.action returns the <input name="action"> DOM element
        // when such an input exists, not the action URL string. Always use
        // getAttribute('action') to read the form's action URL.
        this._state = {
            actionUrl: replaceForm.getAttribute('action') || window.location.href,
            chapters,
            docs,
            mappings: _createMappingRows(chapters),
        };

        const overlay = markFfneUiRoot(document.createElement('div'));
        overlay.id = BULK_REPLACE_MODAL_ID;
        overlay.className = 'ffne-story-bulk-overlay';
        overlay.innerHTML = `
            <div class="ffne-story-bulk-modal" role="dialog" aria-modal="true" aria-labelledby="ffne-story-bulk-title">
                <div class="ffne-story-bulk-header">
                    <h3 id="ffne-story-bulk-title">Bulk Replace Chapters</h3>
                    <button type="button" class="ffne-story-bulk-close" aria-label="Close">x</button>
                </div>
                <div class="ffne-story-bulk-body">
                    <div id="ffne-story-bulk-summary" class="ffne-story-bulk-summary"></div>
                    <table class="ffne-story-bulk-table" contenteditable="false">
                        <thead>
                            <tr>
                                <th>Chapter</th>
                                <th>Source Doc</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="ffne-story-bulk-rows"></tbody>
                    </table>
                    <div id="ffne-story-bulk-results" class="ffne-story-bulk-results" hidden></div>
                    <div class="ffne-story-bulk-footer">
                        <span id="ffne-story-bulk-status" class="ffne-story-bulk-run-status"></span>
                        <button type="button" id="ffne-story-bulk-start" class="ffne-story-bulk-btn">Run Bulk Replace</button>
                        <button type="button" class="ffne-story-bulk-btn" data-ffne-action="close">Close</button>
                    </div>
                </div>
            </div>
        `;

        const rowsBody = overlay.querySelector<HTMLElement>('#ffne-story-bulk-rows');
        const summary = overlay.querySelector<HTMLElement>('#ffne-story-bulk-summary');
        const status = overlay.querySelector<HTMLElement>('#ffne-story-bulk-status');
        const results = overlay.querySelector<HTMLElement>('#ffne-story-bulk-results');
        const startButton = overlay.querySelector<HTMLButtonElement>('#ffne-story-bulk-start');

        if (!rowsBody || !summary || !status || !results || !startButton || !this._state) return;

        this._renderMappingRows(rowsBody, this._state.mappings, this._state.docs, () => {
            this._refreshPlan(summary, startButton);
            _renderFailureTable(results, []);
            status.textContent = '';
        });
        this._refreshPlan(summary, startButton);
        _renderFailureTable(results, []);

        startButton.addEventListener('click', async (e) => {
            if (!this._state) return;
            const plan = _buildMappingPlan(this._state.mappings);
            this._refreshPlan(summary, startButton);
            if (plan.hasBlockingErrors || plan.mappedCount === 0) return;

            const confirmed = confirm(
                `Bulk Replace will replace ${plan.mappedCount} published chapter(s) using FFN's existing replace action.\n\n` +
                'This cannot be undone from FFN Enhancements. Continue?'
            );
            if (!confirmed) return;

            await this.runBulkReplace(e as MouseEvent, plan, status, results);
        });

        overlay.querySelector<HTMLButtonElement>('.ffne-story-bulk-close')
            ?.addEventListener('click', () => this.closeBulkReplaceModal());
        overlay.querySelector<HTMLButtonElement>('[data-ffne-action="close"]')
            ?.addEventListener('click', () => this.closeBulkReplaceModal());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeBulkReplaceModal();
        });

        this._escHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.closeBulkReplaceModal();
        };
        document.addEventListener('keydown', this._escHandler);
        document.body.appendChild(overlay);
    },

    closeBulkReplaceModal: function () {
        document.getElementById(BULK_REPLACE_MODAL_ID)?.remove();
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
        this._state = null;
    },

    _injectStyles: function () {
        injectStyleOnce(BULK_REPLACE_STYLE_ID, storyEditContentStyles);
    },

    _renderMappingRows: function (
        body: HTMLElement,
        mappings: IStoryEditContentMappingRow[],
        docs: IStoryEditContentDoc[],
        onChange: () => void,
    ) {
        const optionsHtml = docs.map(doc => `<option value="${_escapeHtml(doc.docId)}">${_escapeHtml(doc.docName)}</option>`).join('');
        // eslint-disable-next-line no-unsanitized/property -- all user-visible values escaped via _escapeHtml; status/index are internal enums/numbers
        body.innerHTML = mappings.map((mapping, index) => `
            <tr data-row-index="${index}">
                <td>${_escapeHtml(mapping.chapter.chapterLabel)}</td>
                <td>
                    <select class="ffne-story-bulk-select" data-row-index="${index}">
                        <option value="">Skip this chapter</option>
                        ${optionsHtml}
                    </select>
                </td>
                <td data-ffne-status>${mapping.status}</td>
            </tr>
        `).join('');

        body.querySelectorAll<HTMLTableRowElement>('tr[data-row-index]').forEach(row => {
            const index = Number.parseInt(row.getAttribute('data-row-index') || '-1', 10);
            if (Number.isInteger(index) && mappings[index]) {
                mappings[index].modalRow = row;
                this._renderRowStatus(mappings[index]);
            }
        });

        body.querySelectorAll<HTMLSelectElement>('select[data-row-index]').forEach(select => {
            select.addEventListener('change', () => {
                const rowIndex = Number.parseInt(select.getAttribute('data-row-index') || '-1', 10);
                if (!Number.isInteger(rowIndex) || !this._state) return;
                _setManualDocSelection(this._state.mappings, this._state.docs, rowIndex, select.value);
                this._state.mappings.forEach(row => this._renderRowStatus(row));
                this._syncSelectValues(body, this._state.mappings);
                onChange();
            });
        });
    },

    _syncSelectValues: function (body: HTMLElement, mappings: IStoryEditContentMappingRow[]) {
        body.querySelectorAll<HTMLSelectElement>('select[data-row-index]').forEach(select => {
            const rowIndex = Number.parseInt(select.getAttribute('data-row-index') || '-1', 10);
            if (!Number.isInteger(rowIndex) || !mappings[rowIndex]) return;
            select.value = mappings[rowIndex].selectedDocId;
        });
    },

    _renderRowStatus: function (mapping: IStoryEditContentMappingRow) {
        if (!mapping.modalRow) return;

        mapping.modalRow.classList.remove('ffne-story-bulk-row-running', 'ffne-story-bulk-row-success', 'ffne-story-bulk-row-failed');
        if (mapping.status === 'running') mapping.modalRow.classList.add('ffne-story-bulk-row-running');
        if (mapping.status === 'success') mapping.modalRow.classList.add('ffne-story-bulk-row-success');
        if (mapping.status === 'failed') mapping.modalRow.classList.add('ffne-story-bulk-row-failed');

        const statusCell = mapping.modalRow.querySelector<HTMLElement>('[data-ffne-status]');
        if (!statusCell) return;

        statusCell.classList.toggle('ffne-story-bulk-status-duplicate', mapping.status === 'duplicate');
        if (mapping.status === 'skipped' || mapping.status === 'unmapped') {
            statusCell.textContent = 'Skipped';
        } else if (mapping.status === 'mapped') {
            statusCell.textContent = mapping.source === 'autofill' ? 'Autofilled' : 'Mapped';
        } else if (mapping.status === 'duplicate') {
            statusCell.textContent = 'Duplicate doc';
        } else if (mapping.status === 'running') {
            statusCell.textContent = 'Running';
        } else if (mapping.status === 'success') {
            statusCell.textContent = 'Done';
        } else if (mapping.status === 'failed') {
            statusCell.textContent = 'Failed';
        }
    },

    _refreshPlan: function (summary: HTMLElement, startButton: HTMLButtonElement) {
        if (!this._state) return;
        const plan = _buildMappingPlan(this._state.mappings);
        const log = Core.getLogger(this.MODULE_NAME, '_refreshPlan');
        log(`Plan refreshed: ${plan.mappedCount} mapped, ${plan.skippedCount} skipped, ${plan.duplicateDocIds.length} duplicate(s).`);
        const summaryClass = plan.hasBlockingErrors
            ? 'ffne-story-bulk-summary ffne-story-bulk-error'
            : 'ffne-story-bulk-summary';
        summary.className = summaryClass;
        // eslint-disable-next-line no-unsanitized/property -- interpolated values are numbers or static strings
        summary.innerHTML = `
            <div>
                <strong>${plan.mappedCount}</strong> mapped,
                <strong>${plan.skippedCount}</strong> skipped,
                <strong>${plan.duplicateDocIds.length}</strong> duplicate mapping(s).
            </div>
            ${plan.hasBlockingErrors ? '<div>Each source doc can be used only once.</div>' : ''}
        `;
        startButton.disabled = plan.hasBlockingErrors || plan.mappedCount === 0;
        this._state.mappings.forEach(row => this._renderRowStatus(row));
    },

    runBulkReplace: async function (
        e: MouseEvent,
        plan?: IStoryEditContentPlan,
        statusEl?: HTMLElement,
        resultsEl?: HTMLElement,
    ) {
        if (!this._state) return;
        const log = Core.getLogger(this.MODULE_NAME, 'runBulkReplace');

        const activePlan = plan || _buildMappingPlan(this._state.mappings);
        const failures: IStoryEditContentFailure[] = [];
        const failureReasons = new Map<string, string>();
        const mappedRows = activePlan.rows.filter(row => !!row.selectedDocId && row.status !== 'duplicate');
        log(`Bulk Replace requested for ${mappedRows.length} mapped row(s).`, {
            hasBlockingErrors: activePlan.hasBlockingErrors,
            duplicateDocIds: activePlan.duplicateDocIds,
        });

        if (activePlan.hasBlockingErrors || mappedRows.length === 0) {
            if (statusEl) {
                statusEl.textContent = activePlan.hasBlockingErrors
                    ? 'Bulk Replace blocked by duplicate doc mappings.'
                    : 'No chapters are mapped.';
            }
            _renderFailureTable(resultsEl, []);
            log('Bulk Replace blocked before execution.');
            return;
        }

        const setFailure = (storyTextId: string, reason: string) => {
            failureReasons.set(storyTextId, reason);
        };

        const self = this;
        const processRow = async function (row: IStoryEditContentMappingRow): Promise<boolean> {
            return self._replaceChapter(row, setFailure, failureReasons);
        };

        const config: IBulkOperationConfig<IStoryEditContentMappingRow> = {
            verb: 'Replace',
            getItems: () => mappedRows,
            onItemStart: (row, pass, index, total) => {
                row.status = 'running';
                this._renderRowStatus(row);
                if (statusEl) {
                    const action = pass === 2 ? 'Retrying' : 'Replacing';
                    statusEl.textContent = `${action} ${index}/${total}: ${row.chapter.chapterLabel} from ${row.selectedDocName}...`;
                }
            },
            processItem: processRow,
            onItemSuccess: (row) => {
                row.status = 'success';
                this._renderRowStatus(row);
            },
            onPermanentFailure: (row) => {
                row.status = 'failed';
                this._renderRowStatus(row);
                failures.push({
                    chapterLabel: row.chapter.chapterLabel,
                    docName: row.selectedDocName,
                    reason: failureReasons.get(row.chapter.storyTextId) || 'Replace failed after retry.',
                });
                log(`Permanent replace failure for "${row.chapter.chapterLabel}".`, failures[failures.length - 1].reason);
            },
            onFinalize: ({ successCount, totalCount }) => {
                const retryFn = failures.length > 0
                    ? () => { void self._retryFailedReplacements(statusEl, resultsEl); }
                    : undefined;
                _renderFailureTable(resultsEl, failures, retryFn);
                log(`Bulk Replace finalized: ${successCount}/${totalCount} succeeded.`);
                if (statusEl) {
                    if (successCount === totalCount) {
                        statusEl.textContent = `Replaced all ${successCount} chapter(s).`;
                    } else if (successCount > 0) {
                        statusEl.textContent = `Replaced ${successCount}; failed ${totalCount - successCount}.`;
                    } else {
                        statusEl.textContent = 'No chapters were replaced.';
                    }
                }
            },
        };

        await runBulkOperation(e, config);
    },

    _replaceChapter: async function (
        row: IStoryEditContentMappingRow,
        setFailure: (storyTextId: string, reason: string) => void,
        failureReasons: Map<string, string>,
    ): Promise<boolean> {
        const log = Core.getLogger(this.MODULE_NAME, '_replaceChapter');

        row.status = 'running';
        this._renderRowStatus(row);

        const validation = await DocFetchService.validatePrivateDocHasContentWithResult(row.selectedDocId, row.selectedDocName);
        if (!validation.ok) {
            log(`Source doc validation failed for "${row.selectedDocName}".`, validation.reason);
            setFailure(row.chapter.storyTextId, validation.reason || 'Source document validation failed.');
            return false;
        }
        log(`Source doc validation passed for "${row.selectedDocName}".`);

        const result = await StoryReplaceService.submitReplaceForm(
            this._state?.actionUrl || window.location.href,
            row.chapter.storyTextId,
            row.selectedDocId,
        );
        if (!result.ok) {
            log(`Replace failed for "${row.chapter.chapterLabel}" from "${row.selectedDocName}".`, result.reason);
            setFailure(row.chapter.storyTextId, result.reason || 'FFN did not confirm the replacement.');
            return false;
        }

        log(`Replace succeeded for "${row.chapter.chapterLabel}" from "${row.selectedDocName}".`);
        failureReasons.delete(row.chapter.storyTextId);
        return true;
    },

    _retryFailedReplacements: async function (
        statusEl?: HTMLElement,
        resultsEl?: HTMLElement,
    ) {
        if (!this._state) return;
        const log = Core.getLogger(this.MODULE_NAME, '_retryFailedReplacements');

        const failedRows = this._state.mappings.filter(row => row.status === 'failed');
        if (failedRows.length === 0) {
            log('Retry requested but no failed rows found.');
            return;
        }

        log(`Retrying ${failedRows.length} failed replacement(s).`);
        failedRows.forEach(row => {
            row.status = 'mapped';
            this._renderRowStatus(row);
        });

        if (statusEl) statusEl.textContent = `Retrying ${failedRows.length} failed replacement(s)...`;
        _renderFailureTable(resultsEl, []);

        const failures: IStoryEditContentFailure[] = [];
        const failureReasons = new Map<string, string>();

        const setFailure = (storyTextId: string, reason: string) => {
            failureReasons.set(storyTextId, reason);
        };

        const self = this;
        const processRow = async function (row: IStoryEditContentMappingRow): Promise<boolean> {
            return self._replaceChapter(row, setFailure, failureReasons);
        };

        const retryConfig: IBulkOperationConfig<IStoryEditContentMappingRow> = {
            verb: 'Replace',
            getItems: () => failedRows,
            onItemStart: (row, pass, index, total) => {
                row.status = 'running';
                this._renderRowStatus(row);
                if (statusEl) {
                    const action = pass === 2 ? 'Retrying' : 'Replacing';
                    statusEl.textContent = `${action} ${index}/${total}: ${row.chapter.chapterLabel} from ${row.selectedDocName}...`;
                }
            },
            processItem: processRow,
            onItemSuccess: (row) => {
                row.status = 'success';
                this._renderRowStatus(row);
            },
            onPermanentFailure: (row) => {
                row.status = 'failed';
                this._renderRowStatus(row);
                failures.push({
                    chapterLabel: row.chapter.chapterLabel,
                    docName: row.selectedDocName,
                    reason: failureReasons.get(row.chapter.storyTextId) || 'Replace failed after retry.',
                });
                log(`Retry permanent failure for "${row.chapter.chapterLabel}".`, failures[failures.length - 1].reason);
            },
            onFinalize: ({ successCount, totalCount }) => {
                const retryFn = failures.length > 0
                    ? () => { void self._retryFailedReplacements(statusEl, resultsEl); }
                    : undefined;
                _renderFailureTable(resultsEl, failures, retryFn);
                log(`Retry finalized: ${successCount}/${totalCount} succeeded.`);
                if (statusEl) {
                    if (successCount === totalCount) {
                        statusEl.textContent = `Replaced all ${successCount} chapter(s).`;
                    } else if (successCount > 0) {
                        statusEl.textContent = `Replaced ${successCount}; failed ${totalCount - successCount}.`;
                    } else {
                        statusEl.textContent = 'No chapters were replaced.';
                    }
                }
            },
        };

        const fakeEvent = { currentTarget: resultsEl?.querySelector('#ffne-story-bulk-retry') || null } as unknown as MouseEvent;
        await runBulkOperation(fakeEvent, retryConfig);
    },

    _parsePublishedChapters,
    _parseDocOptions,
    _createMappingRows,
    _setManualDocSelection,
    _applySemanticAutofill,
    _buildMappingPlan,
    _renderFailureTable,
    _submitStoryReplaceForm: StoryReplaceService.submitReplaceForm,
};
