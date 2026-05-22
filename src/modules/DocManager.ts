// modules/DocManager.ts

import { Core } from './Core';
import { DocFetchService } from '../services/DocFetchService';
import { Elements } from '../enums/Elements';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { DocxBuilder } from './DocxBuilder';
import { SettingsManager } from './SettingsManager';
import { saveAs } from 'file-saver';
import { DocIframeHandler } from './DocIframeHandler';
import { IBulkOperationConfig, IBulkItem } from '../interfaces/IBulkOperationConfig';
import { applyExportTransforms, stripContentAfterMarker } from '../utils/exportTransform';
import { writeToClipboard } from '../utils/clipboard';
import { sanitizeEditorHtml } from '../utils/htmlSanitizer';
import { SimpleMarkdownParser } from './SimpleMarkdownParser';
import { runBulkOperation, AbortBulkOperation } from '../utils/runBulkOperation';
import { markFfneUiRoot } from '../utils/ffneUi';
import { injectStyleOnce } from '../utils/injectStyleOnce';
import { blobToBytes, bytesToArrayBuffer, bytesToText, createZip, textToBytes, unzipBytes, type ZipFileEntry } from '../utils/zip';
import { Ao3BridgeClient } from '../services/Ao3BridgeClient';
import { h } from '../utils/dom';
import {
    IAo3Chapter,
    IAo3MigrationFailure,
    IAo3MigrationMappingRow,
    IAo3MigrationPlan,
} from '../interfaces/IAo3Migration';
import docManagerStyles from '../styles/doc-manager.css?raw';

const ADVANCED_DRAWER_ID = 'ffne-docmanager-advanced-drawer';
const ADVANCED_MODAL_ID = 'ffne-docmanager-advanced-modal';
const IMPORT_MODAL_ID = 'ffne-docmanager-import-modal';
const AO3_MODAL_ID = 'ffne-docmanager-ao3-modal';
const ADVANCED_STYLE_ID = 'ffne-docmanager-advanced-styles';
type BulkImportFormat = 'markdown' | 'html' | 'docx';
type ActionStatus = 'idle' | 'pending' | 'success' | 'error';

interface BulkImportFormatOption {
    label: string;
    fileLabel: string;
    extensions: string[];
    accept: string;
}

const BULK_IMPORT_FORMAT_OPTIONS: Record<BulkImportFormat, BulkImportFormatOption> = {
    markdown: {
        label: 'Markdown (.md)',
        fileLabel: 'Markdown',
        extensions: ['.md'],
        accept: '.md,text/markdown',
    },
    html: {
        label: 'HTML (.html/.htm)',
        fileLabel: 'HTML',
        extensions: ['.html', '.htm'],
        accept: '.html,.htm,text/html',
    },
    docx: {
        label: 'DOCX (.docx)',
        fileLabel: 'DOCX',
        extensions: ['.docx'],
        accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
};

const SUPPORTED_BULK_IMPORT_EXTENSIONS = new Set(
    Object.values(BULK_IMPORT_FORMAT_OPTIONS).flatMap(option => option.extensions)
);

type BulkImportRowStatus = 'matched' | 'missing' | 'duplicate' | 'running' | 'retrying' | 'success' | 'failed';

interface BulkImportPreviewRow {
    docId: string;
    docName: string;
    expectedFileName: string;
    status: BulkImportRowStatus;
    file: File | null;
    modalRow: HTMLTableRowElement | null;
}

interface BulkImportPlan {
    format: BulkImportFormat;
    totalFiles: number;
    totalDocs: number;
    matchedCount: number;
    missingCount: number;
    duplicateFileNames: string[];
    duplicateDocNames: string[];
    blockedFiles: string[];
    ignoredFiles: string[];
    rows: BulkImportPreviewRow[];
    fileByDocId: Map<string, File>;
    hasBlockingErrors: boolean;
}

interface BulkImportFailure {
    docName: string;
    fileName: string;
    reason: string;
}

interface BulkSimpleFailure {
    docName: string;
    reason: string;
}

interface Ao3MigrationState {
    normalizedWorkUrl: string;
    chapters: IAo3Chapter[];
    sourceItems: IBulkItem[];
    rows: IAo3MigrationMappingRow[];
    convertLineBreaks: boolean;
    stripNotesMarker: string;
}

interface ParsedSemanticDocName {
    prefix: string;
    number: number;
    padding: number;
}

function _sanitizeDocTitle(title: string): string {
    return title.trim().replace(/[/\\?%*:|"<>]/g, '-');
}

function _getCellText(cell: HTMLTableCellElement | undefined): string {
    if (!cell) return '';
    return (cell.innerText || cell.textContent || '').trim();
}

function _collectBulkItems(): IBulkItem[] {
    const allRows = Core.getElements(Elements.DOC_TABLE_BODY_ROWS);
    const items: IBulkItem[] = [];

    for (const row of allRows) {
        const tableRow = row as HTMLTableRowElement;
        const editLink = row.querySelector('a[href*="docid="]') as HTMLAnchorElement;
        if (!editLink) continue;

        const match = editLink.href.match(/docid=(\d+)/);
        if (!match) continue;

        const docName = _getCellText(tableRow.cells[1]);
        if (!docName) continue;

        items.push({
            docId: match[1],
            docName,
            title: _sanitizeDocTitle(docName),
            row: tableRow,
        });
    }

    return items;
}

function _getFileDisplayPath(file: File): string {
    const withPath = file as File & { webkitRelativePath?: string };
    return withPath.webkitRelativePath || file.name;
}

function _getPathFileName(path: string): string {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : path;
}

function _getTopLevelFileName(file: File): string | null {
    const path = _getFileDisplayPath(file);
    const parts = path.split(/[\\/]+/).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length > 2) return null;
    return parts[parts.length - 1];
}

function _getLowerExtension(fileName: string): string {
    const idx = fileName.lastIndexOf('.');
    return idx >= 0 ? fileName.slice(idx).toLowerCase() : '';
}

function _getBulkImportFormatOption(format: BulkImportFormat): BulkImportFormatOption {
    return BULK_IMPORT_FORMAT_OPTIONS[format];
}

function _getBulkImportExpectedFileNames(docName: string, format: BulkImportFormat): string[] {
    return _getBulkImportFormatOption(format).extensions.map(extension => `${docName}${extension}`);
}

function _getBulkImportDefaultSummary(format: BulkImportFormat): string {
    const option = _getBulkImportFormatOption(format);
    return `Selected format: ${option.label}. Select a folder or ${option.fileLabel} files.`;
}

function _getBulkImportDefaultSelection(format: BulkImportFormat): string {
    const option = _getBulkImportFormatOption(format);
    return `No ${option.fileLabel} files selected.`;
}

function _getBulkImportConfirmedLabel(format: BulkImportFormat): string {
    return _getBulkImportFormatOption(format).fileLabel;
}

function _configureDirectoryInput(input: HTMLInputElement): void {
    // Chromium and modern Firefox expose the historical webkitdirectory name.
    // Older Firefox builds used directory/mozdirectory experiments, so keep
    // those harmless attributes too while retaining the multi-file fallback.
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.setAttribute('mozdirectory', '');
    try {
        (input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    } catch {
        // Some engines expose this as readonly or not at all.
    }
}

function _escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _parseSemanticDocName(value: string): ParsedSemanticDocName | null {
    const match = value.trim().match(/^(.*?)(\d+)$/);
    if (!match) return null;

    const parsed = Number.parseInt(match[2], 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;

    return {
        prefix: match[1],
        number: parsed,
        padding: match[2].length,
    };
}

function _buildSourceDocMaps(items: IBulkItem[]) {
    const byNumber = new Map<number, IBulkItem | null>();
    const bySemanticNumber = new Map<string, IBulkItem | null>();

    items.forEach(item => {
        const parsed = _parseSemanticDocName(item.docName);
        if (!parsed) return;

        if (byNumber.has(parsed.number)) {
            byNumber.set(parsed.number, null);
        } else {
            byNumber.set(parsed.number, item);
        }

        const semanticKey = `${parsed.prefix}\u0000${parsed.number}`;
        if (bySemanticNumber.has(semanticKey)) {
            bySemanticNumber.set(semanticKey, null);
            return;
        }
        bySemanticNumber.set(semanticKey, item);
    });

    return {
        byId: new Map(items.map(item => [item.docId, item])),
        byName: new Map(items.map(item => [item.docName, item])),
        byNumber,
        bySemanticNumber,
    };
}

function _createAo3MigrationRows(items: IBulkItem[], chapters: IAo3Chapter[]): IAo3MigrationMappingRow[] {
    const { byNumber } = _buildSourceDocMaps(items);
    return chapters.map(chapter => {
        const matchedSourceItem = byNumber.get(chapter.chapterNumber) || null;
        return {
            chapter,
            selectedSourceItem: matchedSourceItem,
            mappingSource: matchedSourceItem ? 'auto' : 'unmapped',
            hasBeenAutofilled: false,
            status: matchedSourceItem ? 'mapped' : 'skipped',
            modalRow: null,
        };
    });
}

function _getSemanticSourceDocMatch(
    byName: Map<string, IBulkItem>,
    bySemanticNumber: Map<string, IBulkItem | null>,
    prefix: string,
    candidateNumber: number,
    padding: number,
): IBulkItem | null {
    const paddedName = `${prefix}${String(candidateNumber).padStart(padding, '0')}`;
    const exactMatch = byName.get(paddedName);
    if (exactMatch) return exactMatch;

    return bySemanticNumber.get(`${prefix}\u0000${candidateNumber}`) || null;
}

function _applyAo3SourceAutofill(
    rows: IAo3MigrationMappingRow[],
    sourceItems: IBulkItem[],
    anchorIndex: number,
    selectedDocId: string,
): IAo3MigrationMappingRow[] {
    const log = Core.getLogger('doc-manager', '_applyAo3SourceAutofill');
    const anchor = rows[anchorIndex];
    if (!anchor || !selectedDocId) return rows;

    const { byId, byName, bySemanticNumber } = _buildSourceDocMaps(sourceItems);
    const anchorItem = byId.get(selectedDocId);
    const parsed = anchorItem ? _parseSemanticDocName(anchorItem.docName) : null;
    if (!anchorItem || !parsed) {
        log(`No semantic doc suffix found for selected source doc "${anchorItem?.docName || selectedDocId}".`);
        return rows;
    }

    let appliedCount = 0;
    rows.forEach((row, index) => {
        if (index === anchorIndex) return;
        if (row.mappingSource === 'manual' || row.hasBeenAutofilled) return;

        const offset = row.chapter.chapterNumber - anchor.chapter.chapterNumber;
        const candidateNumber = parsed.number + offset;
        if (!Number.isFinite(candidateNumber) || candidateNumber <= 0) return;

        const candidateItem = _getSemanticSourceDocMatch(
            byName,
            bySemanticNumber,
            parsed.prefix,
            candidateNumber,
            parsed.padding,
        );
        if (!candidateItem) return;

        row.selectedSourceItem = candidateItem;
        row.mappingSource = 'autofill';
        row.hasBeenAutofilled = true;
        row.status = 'mapped';
        appliedCount++;
    });

    log(`Autofill from "${anchorItem.docName}" applied to ${appliedCount} AO3 chapter row(s).`, {
        anchorIndex,
        anchorChapter: anchor.chapter.chapterNumber,
    });

    return rows;
}

function _setManualAo3SourceSelection(
    rows: IAo3MigrationMappingRow[],
    sourceItems: IBulkItem[],
    rowIndex: number,
    docId: string,
): IAo3MigrationMappingRow[] {
    const row = rows[rowIndex];
    if (!row) return rows;

    const { byId } = _buildSourceDocMaps(sourceItems);
    const selectedSourceItem = byId.get(docId) || null;
    row.selectedSourceItem = selectedSourceItem;
    row.mappingSource = selectedSourceItem ? 'manual' : 'unmapped';
    row.status = selectedSourceItem ? 'mapped' : 'skipped';

    const log = Core.getLogger('doc-manager', '_setManualAo3SourceSelection');
    if (selectedSourceItem && SettingsManager.get('bulkReplaceAutofill')) {
        log(`Manual source doc selection "${selectedSourceItem.docName}" on AO3 row ${rowIndex}; running semantic autofill.`);
        _applyAo3SourceAutofill(rows, sourceItems, rowIndex, selectedSourceItem.docId);
    } else if (selectedSourceItem) {
        log(`Manual source doc selection "${selectedSourceItem.docName}" on AO3 row ${rowIndex}; semantic autofill disabled.`);
    } else {
        log(`AO3 row ${rowIndex} unmapped by manual source doc selection.`);
    }

    return rows;
}

function _buildAo3MigrationPlan(
    normalizedWorkUrl: string,
    chapters: IAo3Chapter[],
    rows: IAo3MigrationMappingRow[],
    convertLineBreaks: boolean,
    stripNotesMarker: string = '',
): IAo3MigrationPlan {
    const counts = new Map<string, number>();
    let mappedCount = 0;
    let skippedCount = 0;

    rows.forEach(row => {
        if (!row.selectedSourceItem) {
            skippedCount++;
            row.status = 'skipped';
            return;
        }

        mappedCount++;
        row.status = 'mapped';
        counts.set(row.selectedSourceItem.docId, (counts.get(row.selectedSourceItem.docId) || 0) + 1);
    });

    const duplicateSourceDocIds = Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([docId]) => docId);
    const duplicateSet = new Set(duplicateSourceDocIds);

    rows.forEach(row => {
        if (row.selectedSourceItem && duplicateSet.has(row.selectedSourceItem.docId)) {
            row.status = 'duplicate';
        }
    });

    return {
        normalizedWorkUrl,
        chapters,
        rows,
        mappedCount,
        skippedCount,
        duplicateSourceDocIds,
        convertLineBreaks,
        stripNotesMarker: stripNotesMarker.trim(),
        hasBlockingErrors: duplicateSourceDocIds.length > 0,
    };
}

function _renderAo3MigrationFailures(
    container: HTMLElement | null | undefined,
    failures: IAo3MigrationFailure[],
): void {
    if (!container) return;

    if (failures.length === 0) {
        container.hidden = true;
        container.replaceChildren();
        return;
    }

    container.hidden = false;
    container.replaceChildren(
        h('div', { class: 'ffne-dm-import-results-title' }, 'Failed AO3 Migrations'),
        h('table', { class: 'ffne-dm-preview', contenteditable: 'false' },
            h('thead', null,
                h('tr', null,
                    h('th', null, 'Source Doc'),
                    h('th', null, 'AO3 Chapter'),
                    h('th', null, 'Reason'),
                ),
            ),
            h('tbody', null,
                failures.map(failure => h('tr', null,
                    h('td', null, failure.sourceDoc),
                    h('td', null, failure.ao3Chapter),
                    h('td', null, failure.reason),
                )),
            ),
        ),
    );
}

function _renderBulkFailures(
    container: HTMLElement | null | undefined,
    title: string,
    failures: BulkSimpleFailure[],
    onRetry?: () => void,
): void {
    if (!container) return;

    if (failures.length === 0) {
        container.hidden = true;
        container.replaceChildren();
        return;
    }

    container.hidden = false;
    const retryButton = onRetry
        ? h('button', { type: 'button', class: 'ffne-dm-btn ffne-dm-retry-btn' }, 'Retry Failed')
        : null;
    if (retryButton && onRetry) {
        retryButton.addEventListener('click', onRetry);
    }

    const children: Array<string | Node> = [
        h('div', { class: 'ffne-dm-import-results-title' }, title),
        h('table', { class: 'ffne-dm-preview', contenteditable: 'false' },
            h('thead', null,
                h('tr', null,
                    h('th', null, 'Document'),
                    h('th', null, 'Reason'),
                ),
            ),
            h('tbody', null,
                failures.map(failure => h('tr', null,
                    h('td', null, failure.docName),
                    h('td', null, failure.reason),
                )),
            ),
        ),
    ];
    if (retryButton) {
        children.push(h('div', { class: 'ffne-dm-retry-wrap' }, retryButton));
    }
    container.replaceChildren(...children);
}

function _buildBulkImportPlan(
    files: File[],
    items: IBulkItem[] = _collectBulkItems(),
    format: BulkImportFormat = 'markdown',
): BulkImportPlan {
    const formatOption = _getBulkImportFormatOption(format);
    const filesByName = new Map<string, File[]>();
    const blockedFiles: string[] = [];
    const ignoredFiles: string[] = [];
    const duplicateDocNames: string[] = [];
    const itemByExpectedFileName = new Map<string, IBulkItem>();

    for (const item of items) {
        _getBulkImportExpectedFileNames(item.docName, format).forEach(fileName => {
            itemByExpectedFileName.set(fileName, item);
        });
    }

    for (const file of files) {
        const displayPath = _getFileDisplayPath(file);
        const fileName = _getPathFileName(displayPath);
        const extension = _getLowerExtension(fileName);

        if (SUPPORTED_BULK_IMPORT_EXTENSIONS.has(extension) && !formatOption.extensions.includes(extension)) {
            blockedFiles.push(displayPath);
            continue;
        }

        const topLevelFileName = _getTopLevelFileName(file);
        if (!topLevelFileName || !formatOption.extensions.includes(extension)) {
            ignoredFiles.push(displayPath);
            continue;
        }

        const existing = filesByName.get(topLevelFileName) || [];
        existing.push(file);
        filesByName.set(topLevelFileName, existing);
    }

    const duplicateFileNames = Array.from(filesByName.entries())
        .filter(([, matchedFiles]) => matchedFiles.length > 1)
        .map(([fileName]) => fileName);

    const duplicateSet = new Set(duplicateFileNames);
    const fileByDocId = new Map<string, File>();
    const matchedFilesByDocId = new Map<string, Array<{ fileName: string; file: File }>>();
    const missingRows: BulkImportPreviewRow[] = [];

    for (const [fileName, matchedFiles] of filesByName) {
        const item = itemByExpectedFileName.get(fileName);
        const targetDocName = item
            ? item.docName
            : fileName.slice(0, -_getLowerExtension(fileName).length);

        if (duplicateSet.has(fileName)) {
            continue;
        }

        if (item && matchedFiles.length === 1) {
            const existing = matchedFilesByDocId.get(item.docId) || [];
            existing.push({ fileName, file: matchedFiles[0] });
            matchedFilesByDocId.set(item.docId, existing);
            continue;
        }

        if (!item) {
            missingRows.push({
                docId: '',
                docName: targetDocName,
                expectedFileName: fileName,
                status: 'missing',
                file: matchedFiles[0] || null,
                modalRow: null,
            });
        }
    }

    const duplicateDocSet = new Set<string>();
    const rows: BulkImportPreviewRow[] = [];
    let matchedCount = 0;

    for (const [fileName] of filesByName) {
        const item = itemByExpectedFileName.get(fileName);
        const targetDocName = item
            ? item.docName
            : fileName.slice(0, -_getLowerExtension(fileName).length);

        if (duplicateSet.has(fileName)) {
            rows.push({
                docId: item?.docId || '',
                docName: item?.docName || targetDocName,
                expectedFileName: fileName,
                status: 'duplicate',
                file: null,
                modalRow: null,
            });
            continue;
        }

        if (!item) {
            const row = missingRows.find(candidate => candidate.expectedFileName === fileName);
            if (row) rows.push(row);
            continue;
        }

        const matchedFiles = matchedFilesByDocId.get(item.docId) || [];
        if (matchedFiles.length > 1) {
            if (duplicateDocSet.has(item.docId)) continue;
            duplicateDocSet.add(item.docId);
            duplicateDocNames.push(item.docName);
            rows.push({
                docId: item.docId,
                docName: item.docName,
                expectedFileName: matchedFiles.map(entry => entry.fileName).join(' / '),
                status: 'duplicate',
                file: null,
                modalRow: null,
            });
            continue;
        }

        rows.push({
            docId: item.docId,
            docName: item.docName,
            expectedFileName: matchedFiles[0].fileName,
            status: 'matched',
            file: matchedFiles[0].file,
            modalRow: null,
        });
        fileByDocId.set(item.docId, matchedFiles[0].file);
        matchedCount++;
    }

    return {
        format,
        totalFiles: files.length,
        totalDocs: items.length,
        matchedCount,
        missingCount: missingRows.length,
        duplicateFileNames,
        duplicateDocNames,
        blockedFiles,
        ignoredFiles,
        rows,
        fileByDocId,
        hasBlockingErrors: blockedFiles.length > 0 || duplicateFileNames.length > 0 || duplicateDocNames.length > 0,
    };
}

function _getBulkImportRowStatusLabel(status: BulkImportRowStatus): string {
    switch (status) {
        case 'matched':
            return 'Matched';
        case 'missing':
            return 'Missing';
        case 'duplicate':
            return 'Duplicate';
        case 'running':
            return 'Importing';
        case 'retrying':
            return 'Retrying';
        case 'success':
            return 'Done';
        case 'failed':
            return 'Failed';
    }
}

function _renderBulkImportRowStatus(row: BulkImportPreviewRow): void {
    if (!row.modalRow) return;

    row.modalRow.classList.remove('ffne-dm-row-running', 'ffne-dm-row-success', 'ffne-dm-row-failed');
    if (row.status === 'running' || row.status === 'retrying') {
        row.modalRow.classList.add('ffne-dm-row-running');
    }
    if (row.status === 'success') {
        row.modalRow.classList.add('ffne-dm-row-success');
    }
    if (row.status === 'failed') {
        row.modalRow.classList.add('ffne-dm-row-failed');
    }

    const statusCell = row.modalRow.querySelector<HTMLElement>('[data-ffne-status]');
    if (!statusCell) return;
    statusCell.className = `ffne-dm-status-${row.status}`;
    statusCell.textContent = _getBulkImportRowStatusLabel(row.status);
}

function _setActionStatus(element: HTMLElement, status: ActionStatus): void {
    element.classList.remove('ffne-status-pending', 'ffne-status-success', 'ffne-status-error');
    if (status !== 'idle') {
        element.classList.add(`ffne-status-${status}`);
    }
}

function _setRowRunning(row: HTMLTableRowElement, running: boolean): void {
    row.classList.toggle('ffne-dm-row-running', running);
    if (running) {
        row.style.transition = 'background-color 0.3s ease';
    }
}

function _setBulkImportItemStatus(
    plan: BulkImportPlan,
    item: IBulkItem,
    status: Extract<BulkImportRowStatus, 'running' | 'retrying' | 'success' | 'failed'>,
): void {
    const row = plan.rows.find(candidate => candidate.docId === item.docId);
    if (!row) return;
    row.status = status;
    _renderBulkImportRowStatus(row);
}

function _sanitizeImportHtml(html: string): string {
    return sanitizeEditorHtml(html);
}

function _markdownToImportHtml(markdown: string): string {
    return _sanitizeImportHtml(SimpleMarkdownParser.parse(markdown));
}

function _htmlToImportHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return _sanitizeImportHtml(doc.body?.innerHTML || html);
}

function _getXmlChildren(node: Element, localName: string): Element[] {
    return Array.from(node.children).filter(child => child.localName === localName);
}

function _getXmlChild(node: Element, localName: string): Element | null {
    return _getXmlChildren(node, localName)[0] || null;
}

function _getXmlAttributeValue(node: Element | null | undefined, attributeName: string): string {
    if (!node) return '';
    return (node.getAttribute(`w:${attributeName}`) || node.getAttribute(attributeName) || '').toLowerCase();
}

function _isDocxToggleEnabled(node: Element | null | undefined): boolean {
    if (!node) return false;
    const value = _getXmlAttributeValue(node, 'val');
    return !['0', 'false', 'off', 'none'].includes(value);
}

function _getDocxParagraphAlignment(paragraph: Element): 'left' | 'center' | null {
    const pPr = _getXmlChild(paragraph, 'pPr');
    const jc = pPr ? _getXmlChild(pPr, 'jc') : null;
    const value = _getXmlAttributeValue(jc, 'val');
    if (value === 'center' || value === 'left') return value;
    return null;
}

function _isDocxHorizontalRuleParagraph(paragraph: Element): boolean {
    const pPr = _getXmlChild(paragraph, 'pPr');
    const borders = pPr ? _getXmlChild(pPr, 'pBdr') : null;
    const hasBorder = !!(borders && _getXmlChildren(borders, 'bottom').length > 0);
    const hasText = Array.from(paragraph.getElementsByTagName('*'))
        .some(el => el.localName === 't' && !!el.textContent?.trim());
    return hasBorder && !hasText;
}

function _readDocxRunHtml(run: Element): string {
    const runProperties = _getXmlChild(run, 'rPr');
    const isBold = _isDocxToggleEnabled(runProperties ? _getXmlChild(runProperties, 'b') : null);
    const isItalic = _isDocxToggleEnabled(runProperties ? _getXmlChild(runProperties, 'i') : null);
    const underline = runProperties ? _getXmlChild(runProperties, 'u') : null;
    const isUnderline = _isDocxToggleEnabled(underline);

    let content = '';
    Array.from(run.childNodes).forEach(child => {
        if (!(child instanceof Element)) return;
        if (child.localName === 't') {
            content += _escapeHtml(child.textContent || '');
        } else if (child.localName === 'br') {
            content += '<br>';
        }
    });

    if (!content) return '';
    if (isUnderline) content = `<u>${content}</u>`;
    if (isItalic) content = `<em>${content}</em>`;
    if (isBold) content = `<strong>${content}</strong>`;
    return content;
}

async function _docxToImportHtml(file: File): Promise<string> {
    const zip = unzipBytes(new Uint8Array(await _readFileAsArrayBuffer(file)));
    const documentXmlBytes = zip['word/document.xml'];
    const documentXml = documentXmlBytes ? bytesToText(documentXmlBytes) : undefined;
    if (!documentXml) return '';

    const xml = new DOMParser().parseFromString(documentXml, 'application/xml');
    const paragraphs = Array.from(xml.getElementsByTagName('*')).filter(el => el.localName === 'p');
    const htmlParts: string[] = [];

    paragraphs.forEach(paragraph => {
        if (_isDocxHorizontalRuleParagraph(paragraph)) {
            htmlParts.push('<hr>');
            return;
        }

        const alignment = _getDocxParagraphAlignment(paragraph);
        const runsHtml: string[] = [];

        Array.from(paragraph.childNodes).forEach(child => {
            if (!(child instanceof Element)) return;
            if (child.localName === 'r') {
                const html = _readDocxRunHtml(child);
                if (html) runsHtml.push(html);
                return;
            }
            if (child.localName === 'hyperlink') {
                Array.from(child.children)
                    .filter(run => run.localName === 'r')
                    .forEach(run => {
                        const html = _readDocxRunHtml(run);
                        if (html) runsHtml.push(html);
                    });
            }
        });

        const paragraphHtml = runsHtml.join('');
        if (!paragraphHtml.trim()) return;
        const alignAttr = alignment ? ` align="${alignment}"` : '';
        htmlParts.push(`<p${alignAttr}>${paragraphHtml}</p>`);
    });

    return _sanitizeImportHtml(htmlParts.join(''));
}

function _renderBulkImportFailures(container: HTMLElement | null | undefined, failures: BulkImportFailure[]): void {
    if (!container) return;

    if (failures.length === 0) {
        container.hidden = true;
        container.replaceChildren();
        return;
    }

    container.hidden = false;
    container.replaceChildren(
        h('div', { class: 'ffne-dm-import-results-title' }, 'Failed Imports'),
        h('table', { class: 'ffne-dm-preview', contenteditable: 'false' },
            h('thead', null,
                h('tr', null,
                    h('th', null, 'Doc'),
                    h('th', null, 'Selected File'),
                    h('th', null, 'Reason'),
                ),
            ),
            h('tbody', null,
                failures.map(failure => h('tr', null,
                    h('td', null, failure.docName),
                    h('td', null, failure.fileName),
                    h('td', null, failure.reason),
                )),
            ),
        ),
    );
}

function _readFileAsText(file: File): Promise<string> {
    if (typeof file.text === 'function') {
        return file.text();
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
        reader.readAsText(file);
    });
}

function _readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    if (typeof file.arrayBuffer === 'function') {
        return file.arrayBuffer();
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Two-pass retry orchestrator for bulk operations.
 * Handles: row extraction, progress UI, two-pass retry with delays, error handling, button reset.
 * Operation-specific logic injected via callbacks.
 */
async function _runBulkOperation(
    e: MouseEvent,
    config: Omit<IBulkOperationConfig<IBulkItem>, 'getItems'>,
): Promise<void> {
    return runBulkOperation(e, {
        ...config,
        getItems: _collectBulkItems,
    });
}

/**
 * Module responsible for enhancing the Document Manager page (`/docs/docs.php`).
 */
export const DocManager = {
    MODULE_NAME: 'doc-manager',

    /** Cache for dynamically-resolved Life column index. null = not resolved yet. */
    _lifeColIdx: null as number | null,

    _advancedEscHandler: null as ((e: KeyboardEvent) => void) | null,
    _importEscHandler: null as ((e: KeyboardEvent) => void) | null,
    _ao3EscHandler: null as ((e: KeyboardEvent) => void) | null,
    _bulkImportPlan: null as BulkImportPlan | null,
    _ao3MigrationState: null as Ao3MigrationState | null,

    /**
     * Scans table header for "Life" cell to resolve column index dynamically.
     * Falls back to hardcoded 5 if header not found or no match.
     * Cache per page load — no re-scan after first call.
     */
    _resolveLifeColIdx: function (): number {
        if (this._lifeColIdx !== null) return this._lifeColIdx;
        const headerRow = Core.getElement(Elements.DOC_TABLE_HEAD_ROW);
        if (headerRow) {
            const cells = headerRow.querySelectorAll('th, td');
            for (let i = 0; i < cells.length; i++) {
                if (cells[i].textContent?.trim() === 'Life') {
                    this._lifeColIdx = i;
                    return i;
                }
            }
        }
        this._lifeColIdx = 5; // fallback
        return 5;
    },

    /**
     * Initializes the module by checking for the document table and observing for the Copy-N-Paste editor.
     */
    init: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'init');

        Core.onDomReady(() => {
            // 1. Fast Path: Check if table exists immediately
            if (Core.getElement(Elements.DOC_TABLE)) {
                this.injectUI();
            } else {
                this.waitForTable();
            }

            // 2. Observer for Dynamic Copy-N-Paste Editor Iframe
            // The editor spawns dynamically when the radio button is clicked.
            log('Setting up Observer for Copy-N-Paste Iframe...');
            const editorObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node instanceof HTMLElement) {
                            // Check if the node itself is the iframe or contains it.
                            // The ID is usually 'webcontent_ifr' for the Copy-N-Paste box.
                            const iframe = node.matches('#webcontent_ifr')
                                ? node
                                : node.querySelector('#webcontent_ifr');

                            if (iframe && iframe instanceof HTMLIFrameElement) {
                                log('Copy-N-Paste Editor Iframe detected.');
                                DocIframeHandler.attachMarkdownPasterListener(iframe);
                            }
                        }
                    }
                }
            });

            // We observe the body for subtree additions as the editor container is injected dynamically.
            editorObserver.observe(document.body, { childList: true, subtree: true });
        });
    },

    /**
     * Waiting strategy for the main Document Table.
     */
    waitForTable: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'waitForTable');
        log('Table not found. Setting up MutationObserver...');

        const observer = new MutationObserver((_mutations, obs) => {
            const table = Core.getElement(Elements.DOC_TABLE);
            if (table) {
                log('Table detected via Observer.');
                obs.disconnect();
                this.injectUI();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Safety Timeout
        setTimeout(() => { observer.disconnect(); }, 10000);
    },

    /**
     * Orchestrator for injecting all UI elements (Buttons, Columns).
     */
    injectUI: function () {
        this.injectAdvancedDrawer();
        this.injectTableColumn();
    },

    /**
     * Injects the bottom-centre advanced routines drawer for Doc Manager bulk flows.
     */
    injectAdvancedDrawer: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'injectAdvancedDrawer');
        if (document.getElementById(ADVANCED_DRAWER_ID)) return;

        this._injectAdvancedStyles();

        const drawer = markFfneUiRoot(document.createElement('div'));
        drawer.id = ADVANCED_DRAWER_ID;
        const button = h('button', {
            type: 'button',
            class: 'ffne-dm-drawer-pull',
            title: 'Open advanced document routines',
            'aria-label': 'Open advanced document routines',
        },
        h('span', { class: 'ffne-dm-drawer-grabber', 'aria-hidden': 'true' }),
        h('span', { class: 'ffne-dm-drawer-chevron', 'aria-hidden': 'true' }));
        button.addEventListener('click', () => this.openAdvancedRoutinesModal());
        drawer.appendChild(button);

        document.body.appendChild(drawer);
        log('Advanced drawer injected.');
    },

    _injectAdvancedStyles: function () {
        injectStyleOnce(ADVANCED_STYLE_ID, docManagerStyles);
    },

    openAdvancedRoutinesModal: function () {
        if (document.getElementById(ADVANCED_MODAL_ID)) return;

        this._injectAdvancedStyles();

        const overlay = markFfneUiRoot(document.createElement('div'));
        overlay.id = ADVANCED_MODAL_ID;
        overlay.className = 'ffne-dm-overlay';
        const closeButton = h('button', { type: 'button', class: 'ffne-dm-close', 'aria-label': 'Close' }, '\u00d7');
        const bulkExportStatus = h('div', { class: 'ffne-dm-routine-status', 'data-ffne-status': 'bulk-export' });
        const bulkExportResults = h('div', { class: 'ffne-dm-import-results', 'data-ffne-results': 'bulk-export', hidden: true });
        const bulkRefreshStatus = h('div', { class: 'ffne-dm-routine-status', 'data-ffne-status': 'bulk-refresh' });
        const bulkRefreshResults = h('div', { class: 'ffne-dm-import-results', 'data-ffne-results': 'bulk-refresh', hidden: true });
        const bulkExportButton = h('button', { type: 'button', class: 'ffne-dm-btn', 'data-ffne-action': 'bulk-export' }, 'Run');
        const bulkRefreshButton = h('button', { type: 'button', class: 'ffne-dm-btn', 'data-ffne-action': 'bulk-refresh' }, 'Run');
        const bulkImportButton = h('button', { type: 'button', class: 'ffne-dm-btn', 'data-ffne-action': 'bulk-import' }, 'Open');
        const bulkMigrateButton = h('button', { type: 'button', class: 'ffne-dm-btn', 'data-ffne-action': 'bulk-migrate-ao3' }, 'Open');
        overlay.appendChild(
            h('div', { class: 'ffne-dm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ffne-dm-advanced-title' },
                h('div', { class: 'ffne-dm-modal-header' },
                    h('h3', { id: 'ffne-dm-advanced-title' }, 'Advanced Routines'),
                    closeButton,
                ),
                h('div', { class: 'ffne-dm-modal-body' },
                    h('div', { class: 'ffne-dm-routines' },
                        h('div', { class: 'ffne-dm-routine' },
                            h('div', { class: 'ffne-dm-routine-header' },
                                h('span', { class: 'ffne-dm-routine-title' }, 'Bulk Export'),
                                bulkExportButton,
                            ),
                            bulkExportStatus,
                            bulkExportResults,
                        ),
                        h('div', { class: 'ffne-dm-routine' },
                            h('div', { class: 'ffne-dm-routine-header' },
                                h('span', { class: 'ffne-dm-routine-title' }, 'Bulk Refresh'),
                                bulkRefreshButton,
                            ),
                            bulkRefreshStatus,
                            bulkRefreshResults,
                        ),
                        h('div', { class: 'ffne-dm-routine' },
                            h('div', { class: 'ffne-dm-routine-header' },
                                h('span', { class: 'ffne-dm-routine-title' }, 'Bulk Import'),
                                bulkImportButton,
                            ),
                        ),
                        h('div', { class: 'ffne-dm-routine' },
                            h('div', { class: 'ffne-dm-routine-header' },
                                h('span', { class: 'ffne-dm-routine-title' }, 'Bulk Migrate to AO3'),
                                bulkMigrateButton,
                            ),
                        ),
                    ),
                ),
            ),
        );

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeAdvancedRoutinesModal();
        });

        closeButton.addEventListener('click', () => this.closeAdvancedRoutinesModal());
        bulkExportButton.addEventListener('click', (e) => {
            this.runBulkExport(e as MouseEvent, bulkExportStatus, bulkExportResults);
        });
        bulkRefreshButton.addEventListener('click', (e) => {
            this.runBulkRefresh(e as MouseEvent, bulkRefreshStatus, bulkRefreshResults);
        });
        bulkImportButton.addEventListener('click', () => {
            this.closeAdvancedRoutinesModal();
            this.openBulkImportModal();
        });
        bulkMigrateButton.addEventListener('click', () => {
            this.closeAdvancedRoutinesModal();
            this.openAo3MigrationModal();
        });

        this._advancedEscHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.closeAdvancedRoutinesModal();
        };
        document.addEventListener('keydown', this._advancedEscHandler);

        document.body.appendChild(overlay);
    },

    closeAdvancedRoutinesModal: function () {
        const modal = document.getElementById(ADVANCED_MODAL_ID);
        if (modal) modal.remove();

        if (this._advancedEscHandler) {
            document.removeEventListener('keydown', this._advancedEscHandler);
            this._advancedEscHandler = null;
        }
    },

    openBulkImportModal: function () {
        if (document.getElementById(IMPORT_MODAL_ID)) return;

        this._injectAdvancedStyles();
        this._bulkImportPlan = null;

        const overlay = markFfneUiRoot(document.createElement('div'));
        overlay.id = IMPORT_MODAL_ID;
        overlay.className = 'ffne-dm-overlay';
        const closeButton = h('button', { type: 'button', class: 'ffne-dm-close', 'aria-label': 'Close' }, '\u00d7');
        const title = h('h3', { id: 'ffne-dm-import-title' }, 'Bulk Import Markdown (.md)');
        const formatSelect = h('select', { id: 'ffne-dm-import-format', class: 'ffne-dm-input' },
            h('option', { value: 'markdown' }, 'Markdown (.md)'),
            h('option', { value: 'html' }, 'HTML (.html/.htm)'),
            h('option', { value: 'docx' }, 'DOCX (.docx)'),
        );
        const folderButton = h('button', { type: 'button', id: 'ffne-dm-browse-folder', class: 'ffne-dm-btn' }, 'Browse Folder');
        const filesButton = h('button', { type: 'button', id: 'ffne-dm-browse-files', class: 'ffne-dm-btn' }, 'Browse Files');
        const selection = h('span', { id: 'ffne-dm-import-selection', class: 'ffne-dm-selection-label' }, 'No Markdown files selected.');
        const folderInput = h('input', {
            id: 'ffne-dm-import-folder-input',
            class: 'ffne-dm-file-input',
            type: 'file',
            accept: '.md,text/markdown',
            webkitdirectory: true,
            directory: true,
            mozdirectory: true,
            multiple: true,
        });
        const filesInput = h('input', {
            id: 'ffne-dm-import-files-input',
            class: 'ffne-dm-file-input',
            type: 'file',
            accept: '.md,text/markdown',
            multiple: true,
        });
        const startButton = h('button', { type: 'button', id: 'ffne-dm-import-start', class: 'ffne-dm-btn', disabled: true }, 'Import');
        const preview = h('div', { id: 'ffne-dm-import-preview', class: 'ffne-dm-summary' }, 'Selected format: Markdown (.md). Select a folder or Markdown files.');
        const results = h('div', { id: 'ffne-dm-import-results', class: 'ffne-dm-import-results', hidden: true });
        const status = h('span', { id: 'ffne-dm-import-status', class: 'ffne-dm-run-status' });
        const closeImportButton = h('button', { type: 'button', class: 'ffne-dm-btn', 'data-ffne-action': 'close-import' }, 'Close');
        overlay.appendChild(
            h('div', { class: 'ffne-dm-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ffne-dm-import-title' },
                h('div', { class: 'ffne-dm-modal-header' },
                    title,
                    closeButton,
                ),
                h('div', { class: 'ffne-dm-modal-body' },
                    h('div', { class: 'ffne-dm-import-controls' },
                        h('div', { class: 'ffne-dm-form-row ffne-dm-field-row' },
                            h('label', { for: 'ffne-dm-import-format' }, 'Format'),
                            formatSelect,
                        ),
                        h('div', { class: 'ffne-dm-picker-group' },
                            folderButton,
                            filesButton,
                            selection,
                            folderInput,
                            filesInput,
                        ),
                        startButton,
                    ),
                    preview,
                    results,
                    h('div', { class: 'ffne-dm-footer' },
                        status,
                        closeImportButton,
                    ),
                ),
            ),
        );
        let selectedFormat = 'markdown' as BulkImportFormat;

        if (folderInput) {
            _configureDirectoryInput(folderInput);
        }

        const resetSelectedFiles = (format: BulkImportFormat) => {
            const formatOption = _getBulkImportFormatOption(format);
            selectedFormat = format;
            this._bulkImportPlan = null;

            if (formatSelect) formatSelect.value = format;
            if (folderInput) {
                folderInput.value = '';
                folderInput.accept = formatOption.accept;
            }
            if (filesInput) {
                filesInput.value = '';
                filesInput.accept = formatOption.accept;
            }
            if (title) title.textContent = `Bulk Import ${formatOption.label}`;
            if (preview) {
                preview.className = 'ffne-dm-summary';
                preview.textContent = _getBulkImportDefaultSummary(format);
            }
            if (selection) selection.textContent = _getBulkImportDefaultSelection(format);
            if (startButton) startButton.disabled = true;
            if (status) status.textContent = '';
            _renderBulkImportFailures(results, []);
        };

        const updateSelectedFiles = (input: HTMLInputElement, sourceLabel: string) => {
            const files = Array.from(input.files || []);
            const plan = _buildBulkImportPlan(files, undefined, selectedFormat);
            this._bulkImportPlan = plan;
            if (preview && startButton) {
                this._renderBulkImportPreview(preview, startButton, plan);
            }
            _renderBulkImportFailures(results, []);
            if (selection) {
                const formatLabel = _getBulkImportFormatOption(selectedFormat).fileLabel;
                const count = files.length;
                selection.textContent = count === 1
                    ? `${sourceLabel}: 1 ${formatLabel} file selected.`
                    : `${sourceLabel}: ${count} ${formatLabel} files selected.`;
            }
            if (status) status.textContent = '';
        };

        folderButton.addEventListener('click', () => {
            folderInput.value = '';
            folderInput.click();
        });

        filesButton.addEventListener('click', () => {
            filesInput.value = '';
            filesInput.click();
        });

        folderInput.addEventListener('change', () => {
            updateSelectedFiles(folderInput, 'Folder');
        });

        filesInput.addEventListener('change', () => {
            updateSelectedFiles(filesInput, 'Files');
        });

        formatSelect.addEventListener('change', () => {
            resetSelectedFiles((formatSelect.value || 'markdown') as BulkImportFormat);
        });

        startButton.addEventListener('click', async (e) => {
            const plan = this._bulkImportPlan;
            if (!plan || plan.hasBlockingErrors || plan.matchedCount === 0) return;

            const confirmed = confirm(
                `Bulk Import will replace ${plan.matchedCount} document(s) with matched ${_getBulkImportConfirmedLabel(plan.format)} files.\n\n` +
                'This cannot be undone from FFN Enhancements. Continue?'
            );
            if (!confirmed) return;

            await this.runBulkImport(e as MouseEvent, plan, status || undefined, results || undefined);
        });

        closeButton.addEventListener('click', () => this.closeBulkImportModal());
        closeImportButton.addEventListener('click', () => this.closeBulkImportModal());

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeBulkImportModal();
        });

        this._importEscHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.closeBulkImportModal();
        };
        document.addEventListener('keydown', this._importEscHandler);

        resetSelectedFiles(selectedFormat);
        document.body.appendChild(overlay);
    },

    closeBulkImportModal: function () {
        const modal = document.getElementById(IMPORT_MODAL_ID);
        if (modal) modal.remove();

        if (this._importEscHandler) {
            document.removeEventListener('keydown', this._importEscHandler);
            this._importEscHandler = null;
        }

        this._bulkImportPlan = null;
    },

    openAo3MigrationModal: function () {
        if (document.getElementById(AO3_MODAL_ID)) return;

        const log = Core.getLogger(this.MODULE_NAME, 'openAo3MigrationModal');
        log('Opening AO3 migration modal.');

        this._injectAdvancedStyles();
        this._ao3MigrationState = null;

        const overlay = markFfneUiRoot(document.createElement('div'));
        overlay.id = AO3_MODAL_ID;
        overlay.className = 'ffne-dm-overlay';
        const closeButton = h('button', { type: 'button', class: 'ffne-dm-close', 'aria-label': 'Close' }, '\u00d7');
        const workUrlInput = h('input', {
            id: 'ffne-dm-ao3-work-url',
            class: 'ffne-dm-input',
            type: 'url',
            placeholder: 'https://archiveofourown.org/works/123456789/',
        });
        const loadButton = h('button', { type: 'button', id: 'ffne-dm-ao3-load', class: 'ffne-dm-btn' }, 'Load Chapters');
        const linebreakCheckbox = h('input', { id: 'ffne-dm-ao3-linebreaks', type: 'checkbox' });
        const stripMarkerInput = h('input', {
            id: 'ffne-dm-ao3-strip-marker',
            class: 'ffne-dm-input',
            type: 'text',
            placeholder: 'Standalone line only, e.g. Notes:',
        });
        const summary = h(
            'div',
            { id: 'ffne-dm-ao3-summary', class: 'ffne-dm-summary ffne-dm-warning' },
            'Enter an AO3 work URL, then load chapters. AO3 may open in a foreground tab. Complete any browser check or sign-in there and keep that tab open until migration finishes.',
        );
        const mappings = h('div', { id: 'ffne-dm-ao3-mappings' });
        const results = h('div', { id: 'ffne-dm-ao3-results', class: 'ffne-dm-import-results', hidden: true });
        const status = h('span', { id: 'ffne-dm-ao3-status', class: 'ffne-dm-run-status' });
        const startButton = h('button', { type: 'button', id: 'ffne-dm-ao3-start', class: 'ffne-dm-btn', disabled: true }, 'Migrate');
        const closeAo3Button = h('button', { type: 'button', class: 'ffne-dm-btn', 'data-ffne-action': 'close-ao3' }, 'Close');
        overlay.appendChild(
            h('div', { class: 'ffne-dm-modal ffne-dm-modal-wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ffne-dm-ao3-title' },
                h('div', { class: 'ffne-dm-modal-header' },
                    h('h3', { id: 'ffne-dm-ao3-title' }, 'Bulk Migrate to AO3'),
                    closeButton,
                ),
                h('div', { class: 'ffne-dm-modal-body' },
                    h('div', { class: 'ffne-dm-form-row' },
                        workUrlInput,
                        loadButton,
                    ),
                    h('label', { class: 'ffne-dm-checkbox' },
                        linebreakCheckbox,
                        h('span', null, 'Convert source line breaks for AO3'),
                    ),
                    h('div', { class: 'ffne-dm-form-row ffne-dm-field-row' },
                        h('label', { for: 'ffne-dm-ao3-strip-marker' }, 'Strip Out Notes (optional)'),
                        stripMarkerInput,
                    ),
                    summary,
                    mappings,
                    results,
                    h('div', { class: 'ffne-dm-footer' },
                        status,
                        startButton,
                        closeAo3Button,
                    ),
                ),
            ),
        );

        loadButton.addEventListener('click', async () => {
            const normalizedWorkUrl = Ao3BridgeClient.normalizeWorkUrl(workUrlInput.value || '');
            if (!normalizedWorkUrl) {
                log('AO3 chapter load blocked by invalid work URL.', { input: workUrlInput.value || '' });
                summary.className = 'ffne-dm-summary ffne-dm-error';
                summary.textContent = 'Enter a valid AO3 work URL.';
                startButton.disabled = true;
                mappings.replaceChildren();
                status.textContent = '';
                _renderAo3MigrationFailures(results, []);
                return;
            }

            status.textContent = 'Opening AO3 if needed and loading chapters...';
            log('Loading AO3 chapter index.', { workUrl: normalizedWorkUrl });
            const response = await Ao3BridgeClient.fetchChapterIndex(normalizedWorkUrl);
            if (!response.ok) {
                log('AO3 chapter index load failed.', {
                    workUrl: normalizedWorkUrl,
                    reason: response.reason,
                });
                summary.className = 'ffne-dm-summary ffne-dm-error';
                summary.textContent = response.reason || 'Could not load AO3 chapters.';
                mappings.replaceChildren();
                startButton.disabled = true;
                status.textContent = '';
                _renderAo3MigrationFailures(results, []);
                return;
            }

            const sourceItems = _collectBulkItems();
            this._ao3MigrationState = {
                normalizedWorkUrl,
                chapters: response.chapters,
                sourceItems,
                rows: _createAo3MigrationRows(sourceItems, response.chapters),
                convertLineBreaks: !!linebreakCheckbox.checked,
                stripNotesMarker: stripMarkerInput.value.trim() || '',
            };
            log('AO3 chapter index loaded and migration rows prepared.', {
                workUrl: normalizedWorkUrl,
                chapterCount: response.chapters.length,
                sourceDocCount: sourceItems.length,
                convertLineBreaks: !!linebreakCheckbox.checked,
                stripNotesEnabled: !!stripMarkerInput.value.trim(),
            });
            status.textContent = `Loaded ${response.chapters.length} AO3 chapter(s).`;
            _renderAo3MigrationFailures(results, []);
            this._refreshAo3MigrationPreview(summary, mappings, startButton);
        });

        linebreakCheckbox.addEventListener('change', () => {
            if (!this._ao3MigrationState) return;
            this._ao3MigrationState.convertLineBreaks = !!linebreakCheckbox.checked;
            this._refreshAo3MigrationPreview(summary, mappings, startButton);
        });

        stripMarkerInput.addEventListener('input', () => {
            if (!this._ao3MigrationState) return;
            this._ao3MigrationState.stripNotesMarker = stripMarkerInput.value.trim();
            this._refreshAo3MigrationPreview(summary, mappings, startButton);
        });

        startButton.addEventListener('click', async (e) => {
            const plan = this._ao3MigrationState
                ? _buildAo3MigrationPlan(
                    this._ao3MigrationState.normalizedWorkUrl,
                    this._ao3MigrationState.chapters,
                    this._ao3MigrationState.rows,
                    this._ao3MigrationState.convertLineBreaks,
                    this._ao3MigrationState.stripNotesMarker,
                )
                : null;
            if (!plan || plan.hasBlockingErrors || plan.mappedCount === 0) return;

            const confirmed = confirm(
                `Bulk Migrate to AO3 will replace ${plan.mappedCount} AO3 chapter(s).\n\n` +
                'Guardrails active: duplicate source docs are blocked, empty source docs are skipped before AO3 updates, and failed updates retry once.\n\n' +
                'AO3 bridge: keep the AO3 tab open until migration finishes. If AO3 asks for sign-in or a browser check, complete it there and return to this tab.\n\n' +
                'This will overwrite the selected AO3 chapter bodies. Continue?'
            );
            if (!confirmed) {
                log('AO3 migration cancelled at confirmation.', {
                    mappedCount: plan.mappedCount,
                    workUrl: plan.normalizedWorkUrl,
                });
                return;
            }

            log('AO3 migration confirmed by user.', {
                mappedCount: plan.mappedCount,
                skippedCount: plan.skippedCount,
                workUrl: plan.normalizedWorkUrl,
                convertLineBreaks: plan.convertLineBreaks,
                stripNotesEnabled: !!plan.stripNotesMarker,
                forceAo3HtmlCompatibility: true,
            });
            await this.runBulkAo3Migration(e as MouseEvent, plan, status || undefined, results || undefined);
            this._refreshAo3MigrationPreview(summary, mappings, startButton);
        });

        closeButton.addEventListener('click', () => this.closeAo3MigrationModal());
        closeAo3Button.addEventListener('click', () => this.closeAo3MigrationModal());

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeAo3MigrationModal();
        });

        this._ao3EscHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.closeAo3MigrationModal();
        };
        document.addEventListener('keydown', this._ao3EscHandler);

        document.body.appendChild(overlay);
    },

    closeAo3MigrationModal: function () {
        const modal = document.getElementById(AO3_MODAL_ID);
        if (modal) modal.remove();

        if (this._ao3EscHandler) {
            document.removeEventListener('keydown', this._ao3EscHandler);
            this._ao3EscHandler = null;
        }

        this._ao3MigrationState = null;
    },

    _refreshAo3MigrationPreview: function (
        summaryEl: HTMLElement | null,
        mappingsEl: HTMLElement | null,
        startButton: HTMLButtonElement | null,
    ) {
        const state = this._ao3MigrationState;
        if (!summaryEl || !mappingsEl || !startButton || !state) return;

        const plan = _buildAo3MigrationPlan(
            state.normalizedWorkUrl,
            state.chapters,
            state.rows,
            state.convertLineBreaks,
            state.stripNotesMarker,
        );

        startButton.disabled = plan.hasBlockingErrors || plan.mappedCount === 0;

        const duplicateLabels = plan.rows
            .filter(row => row.status === 'duplicate' && row.selectedSourceItem)
            .map(row => row.selectedSourceItem?.docName || '')
            .filter((value, index, values) => !!value && values.indexOf(value) === index);
        const summaryClass = plan.hasBlockingErrors
            ? 'ffne-dm-summary ffne-dm-error'
            : 'ffne-dm-summary';
        const visibleDuplicateLabels = duplicateLabels.slice(0, 6);
        const duplicateSummary = duplicateLabels.length > 0
            ? h('div', { class: 'ffne-dm-summary-detail' },
                h('strong', null, 'Duplicate source docs:'),
                ' ',
                visibleDuplicateLabels.join(', '),
                duplicateLabels.length > visibleDuplicateLabels.length
                    ? `, and ${duplicateLabels.length - visibleDuplicateLabels.length} more`
                    : null,
            )
            : null;

        summaryEl.className = summaryClass;
        const summaryChildren: Array<string | Node> = [
            h('div', null,
                h('strong', null, String(plan.chapters.length)),
                ' AO3 chapter(s), ',
                h('strong', null, String(state.sourceItems.length)),
                ' source doc(s), ',
                h('strong', null, String(plan.mappedCount)),
                ' mapped, ',
                h('strong', null, String(plan.skippedCount)),
                ' skipped.',
            ),
        ];
        if (plan.stripNotesMarker) {
            summaryChildren.push(
                h('div', { class: 'ffne-dm-summary-detail' },
                    h('strong', null, 'Strip marker:'),
                    ' ',
                    plan.stripNotesMarker,
                ),
            );
        }
        if (duplicateSummary) {
            summaryChildren.push(duplicateSummary);
        }
        summaryEl.replaceChildren(...summaryChildren);

        const rows = plan.rows.length > 0
            ? plan.rows.map((row, index) => {
                const select = h('select', { class: 'ffne-dm-select', 'data-ffne-ao3-source': String(index) },
                    h('option', { value: '' }, 'Skip this AO3 chapter'),
                    state.sourceItems.map(item => h('option', { value: item.docId }, item.docName)),
                );
                select.value = row.selectedSourceItem?.docId || '';
                select.addEventListener('change', () => {
                    if (!this._ao3MigrationState) return;
                    _setManualAo3SourceSelection(this._ao3MigrationState.rows, this._ao3MigrationState.sourceItems, index, select.value);
                    this._refreshAo3MigrationPreview(summaryEl, mappingsEl, startButton);
                });
                const rowEl = h('tr', { 'data-row-index': String(index) },
                    h('td', null, row.chapter.label),
                    h('td', null, select),
                    h('td', null, row.mappingSource),
                    h('td', { class: `ffne-dm-status-${row.status}` }, row.status),
                );
                row.modalRow = rowEl;
                return rowEl;
            })
            : [h('tr', null, h('td', { colspan: 4 }, 'No AO3 chapters found.'))];

        mappingsEl.replaceChildren(
            h('div', { class: 'ffne-dm-preview-scroll' },
                h('table', { class: 'ffne-dm-preview', contenteditable: 'false' },
                    h('thead', null,
                        h('tr', null,
                            h('th', null, 'AO3 Chapter'),
                            h('th', null, 'Source Doc'),
                            h('th', null, 'Mapping Source'),
                            h('th', null, 'Status'),
                        ),
                    ),
                    h('tbody', null, rows),
                ),
            ),
        );
    },

    _renderBulkImportPreview: function (
        preview: HTMLElement,
        startButton: HTMLButtonElement,
        plan: BulkImportPlan,
    ) {
        const formatOption = _getBulkImportFormatOption(plan.format);
        const canImport = !plan.hasBlockingErrors && plan.matchedCount > 0;
        startButton.disabled = !canImport;

        const summaryClass = plan.hasBlockingErrors
            ? 'ffne-dm-summary ffne-dm-error'
            : plan.ignoredFiles.length > 0 || plan.missingCount > 0
                ? 'ffne-dm-summary ffne-dm-warning'
                : 'ffne-dm-summary';

        preview.className = summaryClass;
        const rows = plan.rows.length > 0
            ? plan.rows.map(row => {
                const rowEl = h('tr', { 'data-row-doc-id': row.docId, 'data-row-file': row.expectedFileName },
                    h('td', null, row.docName),
                    h('td', null, row.expectedFileName),
                    h('td', { 'data-ffne-status': true }),
                );
                row.modalRow = rowEl;
                return rowEl;
            })
            : [h('tr', null, h('td', { colspan: 3 }, `No top-level ${formatOption.fileLabel} files found.`))];

        const previewChildren: Array<string | Node> = [
            h('div', null,
                h('strong', null, 'Format:'),
                ' ',
                formatOption.label,
            ),
            h('div', null,
                h('strong', null, String(plan.matchedCount)),
                ' matched, ',
                h('strong', null, String(plan.missingCount)),
                ' missing in DocManager, ',
                h('strong', null, String(plan.duplicateFileNames.length + plan.duplicateDocNames.length)),
                ' duplicate, ',
                h('strong', null, String(plan.ignoredFiles.length)),
                ' ignored.',
            ),
        ];
        if (plan.blockedFiles.length > 0) {
            previewChildren.push(
                h('div', null,
                    h('strong', null, 'Blocked:'),
                    ' ',
                    plan.blockedFiles.join(', '),
                ),
            );
        }
        if (plan.duplicateFileNames.length > 0) {
            previewChildren.push(
                h('div', null,
                    h('strong', null, 'Duplicates:'),
                    ' ',
                    plan.duplicateFileNames.join(', '),
                ),
            );
        }
        if (plan.duplicateDocNames.length > 0) {
            previewChildren.push(
                h('div', null,
                    h('strong', null, 'Conflicting matches:'),
                    ' ',
                    plan.duplicateDocNames.join(', '),
                ),
            );
        }
        if (plan.ignoredFiles.length > 0) {
            previewChildren.push(
                h('div', null,
                    h('strong', null, 'Ignored:'),
                    ' ',
                    plan.ignoredFiles.slice(0, 8).join(', '),
                    plan.ignoredFiles.length > 8 ? '...' : null,
                ),
            );
        }
        previewChildren.push(
            h('table', { class: 'ffne-dm-preview', contenteditable: 'false' },
                h('thead', null,
                    h('tr', null,
                        h('th', null, 'Doc'),
                        h('th', null, 'Selected File'),
                        h('th', null, 'Status'),
                    ),
                ),
                h('tbody', null, rows),
            ),
        );
        preview.replaceChildren(...previewChildren);

        plan.rows.forEach(row => _renderBulkImportRowStatus(row));
    },

    /**
     * Injects a new "Export" column into the document management table.
     * Adds an "Export" button to each row for individual downloading.
     */
    injectTableColumn: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'injectTableColumn');

        const table = Core.getElement(Elements.DOC_TABLE);
        if (!table) {
            log('Table not found.');
            return;
        }

        const headerRow = Core.getElement(Elements.DOC_TABLE_HEAD_ROW);

        if (headerRow) {
            // Add Copy column header
            const copyTh = document.createElement('th');
            copyTh.className = 'thead';
            copyTh.innerText = 'Copy';
            copyTh.align = 'center';
            copyTh.width = '5%';
            headerRow.appendChild(copyTh);

            // Add Export column header
            const exportTh = document.createElement('th');
            exportTh.className = 'thead';
            exportTh.innerText = 'Export';
            exportTh.align = 'center';
            exportTh.width = '5%';
            headerRow.appendChild(exportTh);

            // Add Refresh column header
            const refreshTh = document.createElement('th');
            refreshTh.className = 'thead';
            refreshTh.innerText = 'Refresh';
            refreshTh.align = 'center';
            refreshTh.width = '5%';
            headerRow.appendChild(refreshTh);
        }

        const rows = Core.getElements(Elements.DOC_TABLE_BODY_ROWS);

        rows.forEach((row) => {
            if (row.querySelector('th') || row.className.includes('thead')) return;

            // Robust extraction: target the specific edit link to get the ID
            const editLink = row.querySelector('a[href*="docid="]') as HTMLAnchorElement;
            if (!editLink) return;

            // Safe regex match
            const match = editLink.href.match(/docid=(\d+)/);
            if (!match) return;
            const docId = match[1];

            const title = _sanitizeDocTitle(_getCellText((row as HTMLTableRowElement).cells[1]));

            // Add Copy cell
            const copyTd = document.createElement('td');
            copyTd.align = 'center';
            copyTd.vAlign = 'top';
            copyTd.width = '5%';

            const copyLink = document.createElement('a');
            copyLink.innerText = "Copy";
            copyLink.href = "#";
            copyLink.title = "Copy to clipboard";
            copyLink.className = 'ffne-dm-action-link';
            copyLink.onclick = (e) => {
                e.preventDefault();
                this.runSingleClipboardExport(e.currentTarget as HTMLElement, docId, title);
            };
            copyTd.appendChild(copyLink);
            row.appendChild(copyTd);

            // Add Export cell
            const exportTd = document.createElement('td');
            exportTd.align = 'center';
            exportTd.vAlign = 'top';
            exportTd.width = '5%';

            const exportLink = document.createElement('a');
            exportLink.innerText = "Export";
            exportLink.href = "#";
            exportLink.className = 'ffne-dm-action-link';
            exportLink.onclick = (e) => {
                e.preventDefault();
                this.runSingleExport(e.currentTarget as HTMLElement, docId, title);
            };
            exportTd.appendChild(exportLink);
            row.appendChild(exportTd);

            // Add Refresh cell
            const refreshTd = document.createElement('td');
            refreshTd.align = 'center';
            refreshTd.vAlign = 'top';
            refreshTd.width = '5%';

            const refreshLink = document.createElement('a');
            refreshLink.innerText = "Refresh";
            refreshLink.href = "#";
            refreshLink.className = 'ffne-dm-action-link';
            refreshLink.onclick = (e) => {
                e.preventDefault();
                this.runSingleRefresh(e.currentTarget as HTMLElement, docId, title);
            };
            refreshTd.appendChild(refreshLink);
            row.appendChild(refreshTd);
        });

        log('Column injected.');
    },

    /**
     * Updates the Life column for a given row to show "365 days".
     * @param row - The table row element containing the Life column.
     * @param context - Context string for logging (e.g., "single refresh", "bulk pass 1").
     */
    updateLifeColumn: function (row: HTMLTableRowElement, context: string = 'refresh') {
        const log = Core.getLogger(this.MODULE_NAME, 'updateLifeColumn');
        try {
            const lifeCell = row.cells[this._resolveLifeColIdx()];
            if (lifeCell) {
                lifeCell.innerText = '365 days';
                log(`Updated Life column to "365 days" (${context})`);
            }
        } catch (err) {
            log(`Failed to update Life column (${context})`, err);
        }
    },

    /**
     * Handles the export of a single document given a DocID.
     * The output format (Markdown or HTML) is read from SettingsManager at call time,
     * so settings changes take effect on the next export.
     * @param btnElement - The button clicked (for UI feedback).
     * @param docId - The FFN Document ID.
     * @param title - The title of the document.
     */
    runSingleExport: async function (btnElement: HTMLElement, docId: string, title: string) {
        const log = Core.getLogger(this.MODULE_NAME, 'runSingleExport');
        const originalText = btnElement.innerText;

        btnElement.innerText = "...";
        _setActionStatus(btnElement, 'pending');
        btnElement.style.cursor = "wait";

        const format = SettingsManager.get('docDownloadFormat');
        log(`Starting export for ${title} (${docId}) as ${format}`);

        const content = format === DocDownloadFormat.DOCX || format === DocDownloadFormat.HTML
            ? await DocFetchService.fetchPrivateDocAsHtml(docId, title)
            : await DocFetchService.fetchAndConvertPrivateDoc(docId, title);

        if (content) {
            const transformed = applyExportTransforms(content, format);
            if (format === DocDownloadFormat.DOCX) {
                const docxBlob = await DocxBuilder.build(transformed, title);
                saveAs(docxBlob, `${title}.docx`);
            } else {
                const mimeType = format === DocDownloadFormat.HTML
                    ? "text/html;charset=utf-8"
                    : "text/markdown;charset=utf-8";
                saveAs(new Blob([transformed], { type: mimeType }), `${title}.${format}`);
            }
            btnElement.innerText = "Done";
            _setActionStatus(btnElement, 'success');
            setTimeout(() => {
                btnElement.innerText = originalText;
                _setActionStatus(btnElement, 'idle');
                btnElement.style.cursor = "pointer";
            }, 2000);
        } else {
            btnElement.innerText = "Err";
            _setActionStatus(btnElement, 'error');
            btnElement.style.cursor = "pointer";
            log("Failed to fetch document content.");
        }
    },

    /**
     * Copies a single document's content to the system clipboard.
     * Fetches in the configured format, applies export transforms
     * (Ao3 HTML compatibility, append separator), and writes to clipboard.
     * For DOCX format: fetches HTML source and writes as HTML to clipboard,
     * since DOCX is a binary file format not meaningful on clipboard.
     * @param btnElement - The button clicked (for UI feedback).
     * @param docId - The FFN Document ID.
     * @param title - The title of the document.
     */
    runSingleClipboardExport: async function (btnElement: HTMLElement, docId: string, title: string) {
        const log = Core.getLogger(this.MODULE_NAME, 'runSingleClipboardExport');
        const originalText = btnElement.innerText;
        const originalTitle = btnElement.title;

        btnElement.innerText = "...";
        _setActionStatus(btnElement, 'pending');
        btnElement.style.cursor = "wait";

        const format = SettingsManager.get('docDownloadFormat');
        log(`Starting clipboard export for ${title} (${docId}) as ${format}`);

        let content: string | null = null;
        let isHtml = false;

        if (format === DocDownloadFormat.DOCX) {
            content = await DocFetchService.fetchPrivateDocAsHtml(docId, title);
            isHtml = true; // rendered HTML for rich paste
        } else if (format === DocDownloadFormat.HTML) {
            content = await DocFetchService.fetchPrivateDocAsHtml(docId, title);
            isHtml = false; // raw HTML source as plain text (like Markdown writes raw Markdown)
        } else {
            content = await DocFetchService.fetchAndConvertPrivateDoc(docId, title);
            isHtml = false;
        }

        if (content) {
            // For DOCX clipboard writes, treat format as HTML so Ao3
            // compatibility applies (the content is HTML, not binary DOCX).
            const effectiveFormat = format === DocDownloadFormat.DOCX
                ? DocDownloadFormat.HTML
                : format;
            const transformed = applyExportTransforms(content, effectiveFormat);

            const success = await writeToClipboard(transformed, isHtml);

            if (success) {
                btnElement.innerText = "Copied!";
                _setActionStatus(btnElement, 'success');
                log(`Clipboard export successful for "${title}"`);
            } else {
                btnElement.innerText = "Err";
                _setActionStatus(btnElement, 'error');
                log(`Clipboard export failed for "${title}"`);
            }
        } else {
            btnElement.innerText = "Err";
            _setActionStatus(btnElement, 'error');
            log(`Failed to fetch document content for clipboard export.`);
        }

        setTimeout(() => {
            btnElement.innerText = originalText;
            btnElement.title = originalTitle;
            _setActionStatus(btnElement, 'idle');
            btnElement.style.cursor = "pointer";
        }, 2500);
    },

    /**
     * Handles the refresh of a single document given a DocID.
     * @param btnElement - The button clicked (for UI feedback).
     * @param docId - The FFN Document ID.
     * @param title - The title of the document.
     */
    runSingleRefresh: async function (btnElement: HTMLElement, docId: string, title: string) {
        const log = Core.getLogger(this.MODULE_NAME, 'runSingleRefresh');
        const originalText = btnElement.innerText;

        btnElement.innerText = "...";
        _setActionStatus(btnElement, 'pending');
        btnElement.style.cursor = "wait";

        log(`Starting refresh for ${title} (${docId})`);
        const success = await DocFetchService.refreshPrivateDoc(docId, title);

        if (success) {
            btnElement.innerText = "✓";
            _setActionStatus(btnElement, 'success');

            // Update the Life column to show 365 days
            const row = btnElement.closest('tr') as HTMLTableRowElement;
            if (row) {
                this.updateLifeColumn(row, `single refresh: ${title}`);
            }

            setTimeout(() => {
                btnElement.innerText = originalText;
                _setActionStatus(btnElement, 'idle');
                btnElement.style.cursor = "pointer";
            }, 2000);
        } else {
            btnElement.innerText = "✗";
            _setActionStatus(btnElement, 'error');
            log("Failed to refresh document.");
            setTimeout(() => {
                btnElement.innerText = originalText;
                _setActionStatus(btnElement, 'idle');
                btnElement.style.cursor = "pointer";
            }, 3000);
        }
    },

    /**
     * Handles the bulk export of all visible documents into a ZIP file.
     * Delegates to _runBulkOperation for the two-pass retry orchestration.
     * The output format (Markdown or HTML) is read from SettingsManager at call time.
     */
    runBulkExport: async function (
        e: MouseEvent,
        statusEl?: HTMLElement,
        resultsEl?: HTMLElement,
        retryDocIds?: Set<string>,
    ) {
        const log = Core.getLogger(this.MODULE_NAME, 'runBulkExport');
        const format = SettingsManager.get('docDownloadFormat');
        const btn = e.currentTarget as HTMLButtonElement;
        log(`Bulk export format: ${format}`);
        const zipEntries: ZipFileEntry[] = [];
        const failures: BulkSimpleFailure[] = [];
        const failedItems: IBulkItem[] = [];

        if (statusEl) statusEl.textContent = 'Preparing export...';
        _renderBulkFailures(resultsEl, 'Failed Exports', []);

        await _runBulkOperation(e, {
            verb: 'Export',
            filterRows: retryDocIds
                ? (items) => items.filter(item => retryDocIds.has(item.docId))
                : undefined,
            onItemStart: (item, pass, index, total) => {
                if (statusEl) {
                    const action = pass === 2 ? 'Retrying' : 'Exporting';
                    statusEl.textContent = `${action} ${index}/${total}: ${item.title}...`;
                }
            },
            processItem: async (item) => {
                _setRowRunning(item.row, true);
                try {
                    const content = format === DocDownloadFormat.DOCX || format === DocDownloadFormat.HTML
                        ? await DocFetchService.fetchPrivateDocAsHtml(item.docId, item.title)
                        : await DocFetchService.fetchAndConvertPrivateDoc(item.docId, item.title);
                    if (content) {
                        const transformed = applyExportTransforms(content, format);
                        if (format === DocDownloadFormat.DOCX) {
                            const docxBlob = await DocxBuilder.build(transformed, item.title);
                            zipEntries.push({
                                path: `${item.title}.docx`,
                                data: await blobToBytes(docxBlob),
                                options: { level: 0, mtime: new Date() },
                            });
                        } else {
                            zipEntries.push({
                                path: `${item.title}.${format}`,
                                data: textToBytes(transformed),
                                options: { level: 0, mtime: new Date() },
                            });
                        }
                        return true;
                    }
                    return false;
                } finally {
                    _setRowRunning(item.row, false);
                }
            },
            onPermanentFailure: (item) => {
                zipEntries.push({
                    path: `ERROR_${item.title}.txt`,
                    data: textToBytes(`Failed to retrieve content for DocID ${item.docId} after multiple attempts.`),
                    options: { level: 0 },
                });
                failures.push({ docName: item.docName, reason: `Failed to retrieve content for DocID ${item.docId}.` });
                failedItems.push(item);
            },
            onFinalize: async ({ successCount, totalCount }) => {
                if (successCount > 0) {
                    btn.innerText = "Zipping...";
                    if (statusEl) statusEl.textContent = 'Zipping...';
                    log(`Zipping ${successCount} documents`);
                    const blob = new Blob([bytesToArrayBuffer(createZip(zipEntries))], { type: 'application/zip' });
                    const timestamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19);
                    saveAs(blob, `ffn_${timestamp}.zip`);
                    btn.innerText = "Done";
                } else {
                    btn.innerText = "Empty";
                }

                if (statusEl) {
                    if (successCount === totalCount) {
                        statusEl.textContent = `Exported all ${successCount} document(s).`;
                    } else if (successCount > 0) {
                        statusEl.textContent = `Exported ${successCount}; failed ${totalCount - successCount}.`;
                    } else {
                        statusEl.textContent = 'No documents exported.';
                    }
                }

                const retryFn = failedItems.length > 0
                    ? () => {
                        const retryIds = new Set(failedItems.map(item => item.docId));
                        const fakeEvent = { currentTarget: btn } as unknown as MouseEvent;
                        DocManager.runBulkExport(fakeEvent, statusEl, resultsEl, retryIds);
                    }
                    : undefined;
                _renderBulkFailures(resultsEl, 'Failed Exports', failures, retryFn);
            },
        });
    },

    /**
     * Handles the bulk refresh of all visible documents.
     * Delegates to _runBulkOperation for the two-pass retry orchestration.
     */
    runBulkRefresh: async function (
        e: MouseEvent,
        statusEl?: HTMLElement,
        resultsEl?: HTMLElement,
        retryDocIds?: Set<string>,
    ) {
        const log = Core.getLogger(this.MODULE_NAME, 'runBulkRefresh');
        const btn = e.currentTarget as HTMLButtonElement;
        const failures: BulkSimpleFailure[] = [];
        const failedItems: IBulkItem[] = [];

        if (statusEl) statusEl.textContent = 'Preparing refresh...';
        _renderBulkFailures(resultsEl, 'Failed Refreshes', []);

        await _runBulkOperation(e, {
            verb: 'Refresh',
            filterRows: retryDocIds
                ? (items) => items.filter(item => retryDocIds.has(item.docId))
                : (items) => {
                    const before = items.length;
                    const filtered = items.filter(item => {
                        const lifeCell = item.row.cells[DocManager._resolveLifeColIdx()];
                        return !lifeCell || lifeCell.innerText.trim() !== '365 days';
                    });
                    const skipped = before - filtered.length;
                    if (skipped > 0) {
                        log(`Skipped ${skipped} document(s) already at 365 days.`);
                    }
                    if (filtered.length === 0) {
                        log("No documents need refreshing (all already have 365 days).");
                        if (statusEl) statusEl.textContent = 'All documents already have 365 days life remaining.';
                    }
                    return filtered;
                },
            preBatch: (totalCount) => {
                if (statusEl) statusEl.textContent = `Refreshing ${totalCount} document(s). Do not close this tab.`;
            },
            onItemStart: (item, pass, index, total) => {
                if (statusEl) {
                    const action = pass === 2 ? 'Retrying' : 'Refreshing';
                    statusEl.textContent = `${action} ${index}/${total}: ${item.title}...`;
                }
            },
            processItem: async (item) => {
                _setRowRunning(item.row, true);
                try {
                    return await DocFetchService.refreshPrivateDoc(item.docId, item.title);
                } finally {
                    _setRowRunning(item.row, false);
                }
            },
            onItemSuccess: (item, pass) => {
                DocManager.updateLifeColumn(item.row, `bulk pass ${pass}: ${item.title}`);
            },
            onPermanentFailure: (item) => {
                failures.push({ docName: item.docName, reason: `Failed to refresh DocID ${item.docId}.` });
                failedItems.push(item);
            },
            onFinalize: ({ successCount, totalCount }) => {
                if (successCount === totalCount) {
                    btn.innerText = "All Done!";
                    log(`Successfully refreshed all ${successCount} documents`);
                } else if (successCount > 0) {
                    btn.innerText = `${successCount}/${totalCount}`;
                    log(`Refreshed ${successCount} of ${totalCount} documents`);
                } else {
                    btn.innerText = "Failed";
                    log(`Failed to refresh any documents`);
                }

                if (statusEl) {
                    if (successCount === totalCount) {
                        statusEl.textContent = `Refreshed all ${successCount} document(s).`;
                    } else if (successCount > 0) {
                        statusEl.textContent = `Refreshed ${successCount}; failed ${totalCount - successCount}.`;
                    } else {
                        statusEl.textContent = 'No documents refreshed.';
                    }
                }

                const retryFn = failedItems.length > 0
                    ? () => {
                        const retryIds = new Set(failedItems.map(item => item.docId));
                        const fakeEvent = { currentTarget: btn } as unknown as MouseEvent;
                        DocManager.runBulkRefresh(fakeEvent, statusEl, resultsEl, retryIds);
                    }
                    : undefined;
                _renderBulkFailures(resultsEl, 'Failed Refreshes', failures, retryFn);
            },
        });
    },

    /**
     * Handles bulk FFN doc migration into existing AO3 chapters.
     */
    runBulkAo3Migration: async function (
        e: MouseEvent,
        plan: IAo3MigrationPlan,
        statusEl?: HTMLElement,
        resultsEl?: HTMLElement,
    ) {
        const log = Core.getLogger(this.MODULE_NAME, 'runBulkAo3Migration');
        const btn = e.currentTarget as HTMLButtonElement;
        const failureReasons = new Map<string, string>();
        const failures: IAo3MigrationFailure[] = [];
        const failedRows: IAo3MigrationMappingRow[] = [];
        let bulkAbortReason: string | null = null;

        const setFailure = (row: IAo3MigrationMappingRow, reason: string) => {
            failureReasons.set(row.chapter.chapterId, reason);
        };

        const sourceLabelFor = (row: IAo3MigrationMappingRow): string => {
            return row.selectedSourceItem?.docName || '(no source doc)';
        };

        if (plan.hasBlockingErrors || plan.mappedCount === 0) {
            if (statusEl) {
                statusEl.textContent = plan.hasBlockingErrors
                    ? 'Migration blocked by duplicate source doc mappings.'
                    : 'No source docs are mapped.';
            }
            log('AO3 migration blocked before execution.', {
                mappedCount: plan.mappedCount,
                duplicateSourceDocIds: plan.duplicateSourceDocIds,
            });
            _renderAo3MigrationFailures(resultsEl, []);
            return;
        }

        if (statusEl) {
            statusEl.textContent = `Preparing to migrate ${plan.mappedCount} AO3 chapter(s)...`;
        }
        _renderAo3MigrationFailures(resultsEl, []);
        log('AO3 migration preparing bulk runner.', {
            workUrl: plan.normalizedWorkUrl,
            mappedCount: plan.mappedCount,
            skippedCount: plan.skippedCount,
            convertLineBreaks: plan.convertLineBreaks,
            stripNotesEnabled: !!plan.stripNotesMarker,
            forceAo3HtmlCompatibility: true,
        });

        await runBulkOperation<IAo3MigrationMappingRow>(e, {
            verb: 'Migrate',
            getItems: () => plan.rows,
            filterRows: (rows) => rows.filter(row => !!row.selectedSourceItem),
            preBatch: (totalCount) => {
                log('AO3 migration batch started.', {
                    totalCount,
                    workUrl: plan.normalizedWorkUrl,
                    guardrails: [
                        'confirmation before destructive updates',
                        'duplicate source mappings blocked',
                        'empty source docs blocked before AO3 POST',
                        'two-pass retry with configured bulk delays',
                        'per-row failure reporting',
                    ],
                });
            },
            onItemStart: (row, pass, index, total) => {
                log('AO3 migration row started.', {
                    pass,
                    index,
                    total,
                    sourceDoc: sourceLabelFor(row),
                    ao3Chapter: row.chapter.label,
                    ao3ChapterId: row.chapter.chapterId,
                });
                if (!statusEl) return;
                const verb = pass === 2 ? 'Retrying' : 'Migrating';
                statusEl.textContent = `${verb} ${index}/${total}: ${sourceLabelFor(row)} -> ${row.chapter.label}...`;
            },
            processItem: async (row) => {
                const sourceItem = row.selectedSourceItem;
                if (!sourceItem) {
                    setFailure(row, 'No source doc is mapped.');
                    return false;
                }

                _setRowRunning(sourceItem.row, true);
                if (row.modalRow) {
                    _setRowRunning(row.modalRow, true);
                }

                try {
                    log('Fetching FFN source doc for AO3 migration.', {
                        sourceDoc: sourceItem.docName,
                        docId: sourceItem.docId,
                        ao3Chapter: row.chapter.label,
                    });
                    const sourceHtml = await DocFetchService.fetchPrivateDocAsHtml(sourceItem.docId, sourceItem.title);
                    if (sourceHtml === null) {
                        log('AO3 migration blocked because source doc could not be loaded.', {
                            sourceDoc: sourceItem.docName,
                            docId: sourceItem.docId,
                            ao3Chapter: row.chapter.label,
                        });
                        setFailure(row, 'Could not load the FFN source document.');
                        return false;
                    }

                    if (!sourceHtml.trim()) {
                        log('AO3 migration blocked because source doc is empty.', {
                            sourceDoc: sourceItem.docName,
                            docId: sourceItem.docId,
                            ao3Chapter: row.chapter.label,
                        });
                        setFailure(row, 'Source document is empty.');
                        return false;
                    }

                    const strippedSourceHtml = stripContentAfterMarker(sourceHtml, plan.stripNotesMarker);
                    if (plan.stripNotesMarker) {
                        log(strippedSourceHtml === sourceHtml
                            ? 'Strip marker was not found as a standalone line; source content unchanged.'
                            : 'Strip marker matched a standalone line; notes content stripped.', {
                            sourceDoc: sourceItem.docName,
                            marker: plan.stripNotesMarker,
                            beforeLength: sourceHtml.length,
                            afterLength: strippedSourceHtml.length,
                        });
                    }
                    if (!strippedSourceHtml.trim()) {
                        log('AO3 migration blocked because source doc became empty after stripping notes.', {
                            sourceDoc: sourceItem.docName,
                            docId: sourceItem.docId,
                            marker: plan.stripNotesMarker,
                        });
                        setFailure(row, 'Source document is empty after stripping notes.');
                        return false;
                    }

                    const transformedHtml = applyExportTransforms(sourceHtml, DocDownloadFormat.HTML, {
                        forceAo3HtmlCompatibility: true,
                        convertLineBreaks: plan.convertLineBreaks,
                        stripAfterMarker: plan.stripNotesMarker,
                    });
                    log('AO3 migration source content transformed.', {
                        sourceDoc: sourceItem.docName,
                        ao3Chapter: row.chapter.label,
                        originalLength: sourceHtml.length,
                        transformedLength: transformedHtml.length,
                        forceAo3HtmlCompatibility: true,
                        convertLineBreaks: plan.convertLineBreaks,
                        stripNotesEnabled: !!plan.stripNotesMarker,
                    });
                    if (!transformedHtml.trim()) {
                        setFailure(row, 'Transformed chapter content is empty.');
                        return false;
                    }

                    log('Submitting AO3 chapter update.', {
                        sourceDoc: sourceItem.docName,
                        ao3Chapter: row.chapter.label,
                        ao3ChapterId: row.chapter.chapterId,
                        editUrl: row.chapter.editUrl,
                    });
                    const result = await Ao3BridgeClient.updateChapterContent(row.chapter, transformedHtml);
                    if (!result.ok) {
                        log('AO3 chapter update was not confirmed.', {
                            sourceDoc: sourceItem.docName,
                            ao3Chapter: row.chapter.label,
                            reason: result.reason,
                        });
                        setFailure(row, result.reason || 'AO3 did not confirm the update.');

                        if (result.reason && (
                            result.reason.includes('Cloudflare') ||
                            result.reason.includes('DDoS protection') ||
                            result.reason.includes('AO3 bridge') ||
                            result.reason.includes('AO3 login')
                        )) {
                            bulkAbortReason = result.reason;
                            throw new AbortBulkOperation(result.reason);
                        }

                        return false;
                    }

                    log('AO3 chapter update confirmed.', {
                        sourceDoc: sourceItem.docName,
                        ao3Chapter: row.chapter.label,
                        ao3ChapterId: row.chapter.chapterId,
                    });
                    failureReasons.delete(row.chapter.chapterId);
                    return true;
                } catch (err) {
                    if (err instanceof AbortBulkOperation) {
                        throw err;
                    }
                    const reason = err instanceof Error ? err.message : String(err);
                    log(`AO3 migration failed for "${sourceItem.docName}" to "${row.chapter.label}".`, err);
                    setFailure(row, `Unexpected error: ${reason}`);
                    return false;
                } finally {
                    _setRowRunning(sourceItem.row, false);
                    if (row.modalRow) {
                        _setRowRunning(row.modalRow, false);
                    }
                }
            },
            onPermanentFailure: (row) => {
                log('AO3 migration row failed permanently after retry.', {
                    sourceDoc: sourceLabelFor(row),
                    ao3Chapter: row.chapter.label,
                    reason: failureReasons.get(row.chapter.chapterId),
                });
                failures.push({
                    sourceDoc: sourceLabelFor(row),
                    ao3Chapter: row.chapter.label,
                    reason: failureReasons.get(row.chapter.chapterId) || bulkAbortReason || 'AO3 migration failed after retry.',
                });
                failedRows.push(row);
            },
            onFinalize: ({ successCount, totalCount }) => {
                const failedCount = totalCount - successCount;
                _renderAo3MigrationFailures(resultsEl, failures);
                log('AO3 migration finalized.', {
                    successCount,
                    failedCount,
                    totalCount,
                });
                if (successCount === totalCount) {
                    btn.innerText = 'Done';
                    if (statusEl) statusEl.textContent = `Migrated all ${successCount} AO3 chapter(s).`;
                } else if (successCount > 0) {
                    btn.innerText = `${successCount}/${totalCount}`;
                    if (statusEl) statusEl.textContent = `Migrated ${successCount}; failed ${failedCount}.`;
                } else {
                    btn.innerText = 'Failed';
                    if (statusEl) statusEl.textContent = 'No AO3 chapters migrated.';
                }
            },
        });

        if (failedRows.length > 0 && resultsEl) {
            const retryBtn = document.createElement('button');
            retryBtn.textContent = 'Retry Failed';
            retryBtn.className = 'ffne-dm-btn ffne-dm-retry-block';
            retryBtn.addEventListener('click', (retryEvent) => {
                retryBtn.remove();
                const retryPlan: IAo3MigrationPlan = {
                    ...plan,
                    rows: failedRows,
                    mappedCount: failedRows.filter(r => r.status === 'mapped').length,
                    skippedCount: failedRows.filter(r => r.status === 'skipped').length,
                    hasBlockingErrors: false,
                };
                DocManager.runBulkAo3Migration(retryEvent, retryPlan, statusEl, resultsEl);
            });
            resultsEl.appendChild(retryBtn);
        }
    },

    /**
     * Handles bulk import for matched DocManager rows.
     */
    runBulkImport: async function (
        e: MouseEvent,
        plan: BulkImportPlan,
        statusEl?: HTMLElement,
        resultsEl?: HTMLElement,
    ) {
        const log = Core.getLogger(this.MODULE_NAME, 'runBulkImport');
        const btn = e.currentTarget as HTMLButtonElement;
        const failureReasons = new Map<string, string>();
        const failures: BulkImportFailure[] = [];
        const failedItems: IBulkItem[] = [];

        const setFailure = (item: IBulkItem, reason: string) => {
            failureReasons.set(item.docId, reason);
        };

        const fileLabelFor = (item: IBulkItem): string => {
            const file = plan.fileByDocId.get(item.docId);
            return file ? _getFileDisplayPath(file) : '(no matched file)';
        };

        if (plan.hasBlockingErrors || plan.matchedCount === 0) {
            if (statusEl) statusEl.textContent = 'Import blocked.';
            _renderBulkImportFailures(resultsEl, []);
            log('Import blocked by validation state.', {
                blockedFiles: plan.blockedFiles,
                duplicateFileNames: plan.duplicateFileNames,
                matchedCount: plan.matchedCount,
            });
            return;
        }

        if (statusEl) statusEl.textContent = `Preparing to import ${plan.matchedCount} document(s)...`;
        _renderBulkImportFailures(resultsEl, []);

        await _runBulkOperation(e, {
            verb: 'Import',
            filterRows: (items) => items.filter(item => plan.fileByDocId.has(item.docId)),
            onItemStart: (item, pass, index, total) => {
                _setBulkImportItemStatus(plan, item, pass === 2 ? 'retrying' : 'running');
                if (!statusEl) return;
                const verb = pass === 2 ? 'Retrying' : 'Importing';
                statusEl.textContent = `${verb} ${index}/${total}: ${item.docName} from ${fileLabelFor(item)}...`;
            },
            processItem: async (item) => {
                const file = plan.fileByDocId.get(item.docId);
                if (!file) {
                    setFailure(item, `No matched ${_getBulkImportConfirmedLabel(plan.format)} file was found.`);
                    _setBulkImportItemStatus(plan, item, 'failed');
                    return false;
                }

                _setRowRunning(item.row, true);

                try {
                    let html = '';
                    if (plan.format === 'markdown') {
                        const markdown = await _readFileAsText(file);
                        if (!markdown.trim()) {
                            log(`Skipping "${item.docName}" because matched file is empty.`);
                            setFailure(item, 'Matched Markdown file is empty.');
                            _setBulkImportItemStatus(plan, item, 'failed');
                            return false;
                        }
                        html = _markdownToImportHtml(markdown);
                    } else if (plan.format === 'html') {
                        const sourceHtml = await _readFileAsText(file);
                        if (!sourceHtml.trim()) {
                            log(`Skipping "${item.docName}" because matched file is empty.`);
                            setFailure(item, 'Matched HTML file is empty.');
                            _setBulkImportItemStatus(plan, item, 'failed');
                            return false;
                        }
                        html = _htmlToImportHtml(sourceHtml);
                    } else {
                        html = await _docxToImportHtml(file);
                    }

                    if (!html.trim()) {
                        log(`Skipping "${item.docName}" because ${plan.format} conversion produced no HTML.`);
                        setFailure(item, `${_getBulkImportConfirmedLabel(plan.format)} conversion produced no importable HTML.`);
                        _setBulkImportItemStatus(plan, item, 'failed');
                        return false;
                    }

                    const result = await DocFetchService.replacePrivateDocContentWithResult(item.docId, item.title, html);
                    if (!result.ok) {
                        setFailure(item, result.reason || 'FFN did not confirm the save.');
                        _setBulkImportItemStatus(plan, item, 'failed');
                        return false;
                    }

                    failureReasons.delete(item.docId);
                    return true;
                } catch (err) {
                    log(`Failed to import "${item.docName}".`, err);
                    const reason = err instanceof Error ? err.message : String(err);
                    setFailure(item, `Unexpected error: ${reason}`);
                    _setBulkImportItemStatus(plan, item, 'failed');
                    return false;
                } finally {
                    _setRowRunning(item.row, false);
                }
            },
            onItemSuccess: (item, pass) => {
                _setBulkImportItemStatus(plan, item, 'success');
                DocManager.updateLifeColumn(item.row, `bulk import pass ${pass}: ${item.title}`);
            },
            onPermanentFailure: (item) => {
                _setBulkImportItemStatus(plan, item, 'failed');
                log(`Permanent import failure for "${item.docName}".`);
                failures.push({
                    docName: item.docName,
                    fileName: fileLabelFor(item),
                    reason: failureReasons.get(item.docId) || 'Import failed after retry.',
                });
                failedItems.push(item);
            },
            onFinalize: ({ successCount, totalCount }) => {
                const failedCount = totalCount - successCount;
                _renderBulkImportFailures(resultsEl, failures);
                if (successCount === totalCount) {
                    btn.innerText = 'Done';
                    if (statusEl) statusEl.textContent = `Imported all ${successCount} document(s).`;
                    log(`Successfully imported all ${successCount} documents.`);
                } else if (successCount > 0) {
                    btn.innerText = `${successCount}/${totalCount}`;
                    if (statusEl) statusEl.textContent = `Imported ${successCount}; failed ${failedCount}.`;
                    log(`Imported ${successCount} of ${totalCount} documents.`);
                } else {
                    btn.innerText = 'Failed';
                    if (statusEl) statusEl.textContent = 'No documents imported.';
                    log('Failed to import any documents.');
                }
            },
        });

        if (failedItems.length > 0 && resultsEl) {
            const retryBtn = document.createElement('button');
            retryBtn.textContent = 'Retry Failed';
            retryBtn.className = 'ffne-dm-btn ffne-dm-retry-block-tight';
            retryBtn.addEventListener('click', (retryEvent) => {
                retryBtn.remove();
                const retryPlan: BulkImportPlan = {
                    ...plan,
                    matchedCount: failedItems.filter(item => plan.fileByDocId.has(item.docId)).length,
                    hasBlockingErrors: false,
                    fileByDocId: new Map(
                        failedItems
                            .filter(item => plan.fileByDocId.has(item.docId))
                            .map(item => [item.docId, plan.fileByDocId.get(item.docId)!])
                    ),
                };
                DocManager.runBulkImport(retryEvent, retryPlan, statusEl, resultsEl);
            });
            resultsEl.appendChild(retryBtn);
        }
    },

    // Exported for tests — verifies button-reference lifecycle in onFinalize callbacks.
    _runBulkOperation,
    _buildBulkImportPlan,
    _createAo3MigrationRows,
    _setManualAo3SourceSelection,
    _applyAo3SourceAutofill,
    _buildAo3MigrationPlan,
    _renderAo3MigrationFailures,
    _getTopLevelFileName,
    _markdownToImportHtml,
    _htmlToImportHtml,
    _docxToImportHtml,
    _sanitizeImportHtml,
};
