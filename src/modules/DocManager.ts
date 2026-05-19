// modules/DocManager.ts

import { Core } from './Core';
import { DocFetchService } from '../services/DocFetchService';
import { Elements } from '../enums/Elements';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { DocxBuilder } from './DocxBuilder';
import { SettingsManager } from './SettingsManager';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DocIframeHandler } from './DocIframeHandler';
import { IBulkOperationConfig, IBulkItem } from '../interfaces/IBulkOperationConfig';
import { applyExportTransforms, stripContentAfterMarker } from '../utils/exportTransform';
import { writeToClipboard } from '../utils/clipboard';
import { sanitizeEditorHtml } from '../utils/htmlSanitizer';
import { SimpleMarkdownParser } from './SimpleMarkdownParser';
import { runBulkOperation, AbortBulkOperation } from '../utils/runBulkOperation';
import { Ao3BridgeClient } from '../services/Ao3BridgeClient';
import {
    IAo3Chapter,
    IAo3MigrationFailure,
    IAo3MigrationMappingRow,
    IAo3MigrationPlan,
} from '../interfaces/IAo3Migration';
import { BRAND, SEMANTIC, UI, SHADOW } from '../styles/tokens';

const ADVANCED_DRAWER_ID = 'ffne-docmanager-advanced-drawer';
const ADVANCED_MODAL_ID = 'ffne-docmanager-advanced-modal';
const IMPORT_MODAL_ID = 'ffne-docmanager-import-modal';
const AO3_MODAL_ID = 'ffne-docmanager-ao3-modal';
const ADVANCED_STYLE_ID = 'ffne-docmanager-advanced-styles';
type BulkImportFormat = 'markdown' | 'html' | 'docx';

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
        container.innerHTML = '';
        return;
    }

    const rowsHtml = failures.map(failure => `
        <tr>
            <td>${_escapeHtml(failure.sourceDoc)}</td>
            <td>${_escapeHtml(failure.ao3Chapter)}</td>
            <td>${_escapeHtml(failure.reason)}</td>
        </tr>
    `).join('');

    container.hidden = false;
    container.innerHTML = `
        <div class="ffne-dm-import-results-title">Failed AO3 Migrations</div>
        <table class="ffne-dm-preview" contenteditable="false">
            <thead>
                <tr>
                    <th>Source Doc</th>
                    <th>AO3 Chapter</th>
                    <th>Reason</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;
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
        container.innerHTML = '';
        return;
    }

    const rowsHtml = failures.map(failure => `
        <tr>
            <td>${_escapeHtml(failure.docName)}</td>
            <td>${_escapeHtml(failure.reason)}</td>
        </tr>
    `).join('');

    const retryHtml = onRetry
        ? '<div style="margin-top:8px;"><button type="button" class="ffne-dm-btn ffne-dm-retry-btn">Retry Failed</button></div>'
        : '';

    container.hidden = false;
    container.innerHTML = `
        <div class="ffne-dm-import-results-title">${title}</div>
        <table class="ffne-dm-preview" contenteditable="false">
            <thead>
                <tr>
                    <th>Document</th>
                    <th>Reason</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        ${retryHtml}
    `;

    if (onRetry) {
        container.querySelector<HTMLButtonElement>('.ffne-dm-retry-btn')
            ?.addEventListener('click', onRetry);
    }
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
    const zip = await JSZip.loadAsync(await _readFileAsArrayBuffer(file));
    const documentXml = await zip.file('word/document.xml')?.async('string');
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
        container.innerHTML = '';
        return;
    }

    const rowsHtml = failures.map(failure => `
        <tr>
            <td>${_escapeHtml(failure.docName)}</td>
            <td>${_escapeHtml(failure.fileName)}</td>
            <td>${_escapeHtml(failure.reason)}</td>
        </tr>
    `).join('');

    container.hidden = false;
    container.innerHTML = `
        <div class="ffne-dm-import-results-title">Failed Imports</div>
        <table class="ffne-dm-preview" contenteditable="false">
            <thead>
                <tr>
                    <th>Doc</th>
                    <th>Selected File</th>
                    <th>Reason</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;
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

        const drawer = document.createElement('div');
        drawer.id = ADVANCED_DRAWER_ID;
        drawer.innerHTML = `
            <button
                type="button"
                class="ffne-dm-drawer-pull"
                title="Open advanced document routines"
                aria-label="Open advanced document routines"
            >
                <span class="ffne-dm-drawer-grabber" aria-hidden="true"></span>
                <span class="ffne-dm-drawer-chevron" aria-hidden="true"></span>
            </button>
        `;

        const button = drawer.querySelector<HTMLButtonElement>('button');
        button?.addEventListener('click', () => this.openAdvancedRoutinesModal());

        document.body.appendChild(drawer);
        log('Advanced drawer injected.');
    },

    _injectAdvancedStyles: function () {
        if (document.getElementById(ADVANCED_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = ADVANCED_STYLE_ID;
        style.textContent = `
            #${ADVANCED_DRAWER_ID} {
                position: fixed;
                left: 50%;
                bottom: 0;
                transform: translateX(-50%);
                z-index: 99998;
                line-height: 0;
            }
            .ffne-dm-btn {
                appearance: none;
                border: 1px solid ${UI.BORDER_CHROME};
                background: ${BRAND.BG};
                color: ${BRAND.TEXT};
                font-family: Verdana, Arial, sans-serif;
                font-size: 12px;
                line-height: 18px;
                padding: 4px 10px;
                border-radius: 3px;
                cursor: pointer;
                box-shadow: 0 1px 2px ${SHADOW.SUBTLE};
            }
            .ffne-dm-btn:hover {
                background: ${BRAND.HOVER_BG};
                color: ${BRAND.HOVER_TEXT};
            }
            .ffne-dm-drawer-pull {
                appearance: none;
                width: 154px;
                height: 28px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 3px;
                padding: 3px 0 4px;
                border: 1px solid ThreeDShadow;
                border-bottom: 0;
                border-radius: 10px 10px 0 0;
                background: ButtonFace;
                color: ButtonText;
                cursor: pointer;
                box-shadow: 0 -1px 6px ${SHADOW.DRAWER};
            }
            .ffne-dm-drawer-pull:hover {
                filter: brightness(0.97);
            }
            .ffne-dm-drawer-pull:focus-visible {
                outline: 2px solid Highlight;
                outline-offset: 2px;
            }
            .ffne-dm-drawer-grabber {
                width: 52px;
                height: 4px;
                border-radius: 999px;
                background: currentColor;
                opacity: 0.45;
            }
            .ffne-dm-drawer-chevron {
                width: 10px;
                height: 10px;
                border-top: 2px solid currentColor;
                border-left: 2px solid currentColor;
                transform: rotate(45deg);
                opacity: 0.72;
            }
            .ffne-dm-btn:disabled {
                color: ${UI.TEXT_MUTED};
                cursor: default;
                opacity: 0.65;
            }
            .ffne-dm-overlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                background: ${SHADOW.MODAL};
                font-family: Verdana, Arial, sans-serif;
            }
            .ffne-dm-modal {
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                width: min(720px, calc(100vw - 32px));
                max-height: min(760px, calc(100vh - 32px));
                overflow: auto;
                background: ${UI.WHITE};
                border: 1px solid ${UI.BORDER_CHROME};
                box-shadow: 0 3px 18px ${SHADOW.MODAL};
            }
            .ffne-dm-modal-sm {
                width: min(460px, calc(100vw - 32px));
            }
            .ffne-dm-modal-wide {
                width: min(1080px, calc(100vw - 32px));
            }
            .ffne-dm-modal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                background: ${BRAND.PRIMARY};
                color: ${UI.WHITE};
                padding: 7px 10px;
                border-bottom: 1px solid ${BRAND.DARK};
            }
            .ffne-dm-modal-header h3 {
                margin: 0;
                font-size: 13px;
                line-height: 18px;
                font-weight: 700;
            }
            .ffne-dm-close {
                appearance: none;
                border: 0;
                background: transparent;
                color: ${UI.WHITE};
                cursor: pointer;
                font-size: 18px;
                line-height: 18px;
                padding: 0 4px;
            }
            .ffne-dm-modal-body {
                padding: 12px;
                color: ${UI.TEXT_BODY};
                font-size: 12px;
            }
            .ffne-dm-routines {
                display: grid;
                gap: 8px;
            }
            .ffne-dm-routine {
                border: 1px solid #d8d8d8;
                background: ${UI.CARD_BG};
                padding: 8px;
            }
            .ffne-dm-routine-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .ffne-dm-routine-status {
                margin-top: 4px;
                color: ${UI.TEXT_DISABLED};
                font-size: 11px;
            }
            .ffne-dm-routine-status:empty {
                display: none;
            }
            .ffne-dm-routine-title {
                font-weight: 700;
                color: ${UI.TEXT_BODY};
            }
            .ffne-dm-import-controls {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 10px;
            }
            .ffne-dm-input,
            .ffne-dm-select {
                font: inherit;
                padding: 4px 6px;
                border: 1px solid ${UI.BORDER_INPUT};
                min-width: 0;
            }
            .ffne-dm-input {
                flex: 1 1 280px;
            }
            .ffne-dm-checkbox {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: ${UI.TEXT_BODY};
            }
            .ffne-dm-form-row {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 10px;
            }
            .ffne-dm-form-row label {
                flex: 0 0 auto;
            }
            .ffne-dm-field-row label {
                min-width: 130px;
            }
            .ffne-dm-file-input {
                display: none;
            }
            .ffne-dm-picker-group {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .ffne-dm-selection-label {
                color: ${UI.TEXT_DISABLED};
                font-size: 11px;
            }
            .ffne-dm-summary {
                margin: 8px 0;
                padding: 7px 8px;
                background: ${UI.BG_INFO};
                border: 1px solid ${UI.BORDER_BRAND_LIGHT};
                line-height: 1.45;
            }
            .ffne-dm-summary-detail {
                margin-top: 3px;
            }
            .ffne-dm-warning {
                color: ${SEMANTIC.WARNING_TEXT_DARK};
                background: ${SEMANTIC.WARNING_BG};
                border-color: ${SEMANTIC.WARNING_BORDER};
            }
            .ffne-dm-error {
                color: ${SEMANTIC.ERROR_TEXT};
                background: ${SEMANTIC.ERROR_BG};
                border-color: ${SEMANTIC.ERROR_BORDER};
            }
            .ffne-dm-preview {
                width: 100%;
                border-collapse: collapse;
                margin-top: 8px;
                cursor: default;
                user-select: none;
            }
            .ffne-dm-preview-scroll {
                max-height: min(460px, calc(100vh - 310px));
                overflow: auto;
                border: 1px solid ${UI.BORDER_BRAND_LIGHT};
                margin-top: 8px;
            }
            .ffne-dm-preview-scroll .ffne-dm-preview {
                margin-top: 0;
            }
            .ffne-dm-preview th {
                background: ${BRAND.BG};
                color: ${UI.TEXT_BODY};
                border: 1px solid ${UI.BORDER_TABLE};
                padding: 5px 6px;
                text-align: left;
                cursor: default;
            }
            .ffne-dm-preview td {
                border: 1px solid ${UI.BORDER_LIGHT};
                padding: 5px 6px;
                vertical-align: top;
                cursor: default;
            }
            .ffne-dm-row-running {
                background: ${SEMANTIC.RUNNING_BG};
            }
            .ffne-dm-row-success {
                background: ${SEMANTIC.SUCCESS_BG};
            }
            .ffne-dm-row-failed {
                background: ${SEMANTIC.ERROR_BG};
            }
            .ffne-dm-status-matched { color: ${SEMANTIC.SUCCESS_TEXT}; font-weight: 700; }
            .ffne-dm-status-missing { color: ${UI.TEXT_MUTED}; }
            .ffne-dm-status-duplicate { color: ${SEMANTIC.ERROR_TEXT}; font-weight: 700; }
            .ffne-dm-status-running,
            .ffne-dm-status-retrying { color: ${SEMANTIC.WARNING_TEXT}; font-weight: 700; }
            .ffne-dm-status-success { color: ${SEMANTIC.SUCCESS_TEXT}; font-weight: 700; }
            .ffne-dm-status-failed { color: ${SEMANTIC.ERROR_TEXT}; font-weight: 700; }
            .ffne-dm-status-mapped { color: ${SEMANTIC.SUCCESS_TEXT}; font-weight: 700; }
            .ffne-dm-status-skipped { color: ${UI.TEXT_MUTED}; }
            .ffne-dm-footer {
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 8px;
                margin-top: 10px;
            }
            .ffne-dm-run-status {
                margin-right: auto;
                color: ${UI.TEXT_DISABLED};
            }
            .ffne-dm-import-results {
                margin-top: 10px;
                padding: 7px 8px;
                color: ${SEMANTIC.ERROR_TEXT};
                background: ${SEMANTIC.ERROR_BG};
                border: 1px solid ${SEMANTIC.ERROR_BORDER};
            }
            .ffne-dm-import-results[hidden] {
                display: none;
            }
            .ffne-dm-import-results-title {
                font-weight: 700;
                margin-bottom: 6px;
            }
        `;
        document.head.appendChild(style);
    },

    openAdvancedRoutinesModal: function () {
        if (document.getElementById(ADVANCED_MODAL_ID)) return;

        this._injectAdvancedStyles();

        const overlay = document.createElement('div');
        overlay.id = ADVANCED_MODAL_ID;
        overlay.className = 'ffne-dm-overlay';
        overlay.innerHTML = `
            <div class="ffne-dm-modal" role="dialog" aria-modal="true" aria-labelledby="ffne-dm-advanced-title">
                <div class="ffne-dm-modal-header">
                    <h3 id="ffne-dm-advanced-title">Advanced Routines</h3>
                    <button type="button" class="ffne-dm-close" aria-label="Close">x</button>
                </div>
                <div class="ffne-dm-modal-body">
                    <div class="ffne-dm-routines">
                        <div class="ffne-dm-routine">
                            <div class="ffne-dm-routine-header">
                                <span class="ffne-dm-routine-title">Bulk Export</span>
                                <button type="button" class="ffne-dm-btn" data-ffne-action="bulk-export">Run</button>
                            </div>
                            <div class="ffne-dm-routine-status" data-ffne-status="bulk-export"></div>
                            <div class="ffne-dm-import-results" data-ffne-results="bulk-export" hidden></div>
                        </div>
                        <div class="ffne-dm-routine">
                            <div class="ffne-dm-routine-header">
                                <span class="ffne-dm-routine-title">Bulk Refresh</span>
                                <button type="button" class="ffne-dm-btn" data-ffne-action="bulk-refresh">Run</button>
                            </div>
                            <div class="ffne-dm-routine-status" data-ffne-status="bulk-refresh"></div>
                            <div class="ffne-dm-import-results" data-ffne-results="bulk-refresh" hidden></div>
                        </div>
                        <div class="ffne-dm-routine">
                            <div class="ffne-dm-routine-header">
                                <span class="ffne-dm-routine-title">Bulk Import</span>
                                <button type="button" class="ffne-dm-btn" data-ffne-action="bulk-import">Open</button>
                            </div>
                        </div>
                        <div class="ffne-dm-routine">
                            <div class="ffne-dm-routine-header">
                                <span class="ffne-dm-routine-title">Bulk Migrate to AO3</span>
                                <button type="button" class="ffne-dm-btn" data-ffne-action="bulk-migrate-ao3">Open</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeAdvancedRoutinesModal();
        });

        overlay.querySelector<HTMLButtonElement>('.ffne-dm-close')
            ?.addEventListener('click', () => this.closeAdvancedRoutinesModal());

        overlay.querySelector<HTMLButtonElement>('[data-ffne-action="bulk-export"]')
            ?.addEventListener('click', (e) => {
                const statusEl = overlay.querySelector<HTMLElement>('[data-ffne-status="bulk-export"]');
                const resultsEl = overlay.querySelector<HTMLElement>('[data-ffne-results="bulk-export"]');
                this.runBulkExport(e as MouseEvent, statusEl || undefined, resultsEl || undefined);
            });

        overlay.querySelector<HTMLButtonElement>('[data-ffne-action="bulk-refresh"]')
            ?.addEventListener('click', (e) => {
                const statusEl = overlay.querySelector<HTMLElement>('[data-ffne-status="bulk-refresh"]');
                const resultsEl = overlay.querySelector<HTMLElement>('[data-ffne-results="bulk-refresh"]');
                this.runBulkRefresh(e as MouseEvent, statusEl || undefined, resultsEl || undefined);
            });

        overlay.querySelector<HTMLButtonElement>('[data-ffne-action="bulk-import"]')
            ?.addEventListener('click', () => {
                this.closeAdvancedRoutinesModal();
                this.openBulkImportModal();
            });

        overlay.querySelector<HTMLButtonElement>('[data-ffne-action="bulk-migrate-ao3"]')
            ?.addEventListener('click', () => {
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

        const overlay = document.createElement('div');
        overlay.id = IMPORT_MODAL_ID;
        overlay.className = 'ffne-dm-overlay';
        overlay.innerHTML = `
            <div class="ffne-dm-modal" role="dialog" aria-modal="true" aria-labelledby="ffne-dm-import-title">
                <div class="ffne-dm-modal-header">
                    <h3 id="ffne-dm-import-title">Bulk Import Markdown (.md)</h3>
                    <button type="button" class="ffne-dm-close" aria-label="Close">x</button>
                </div>
                <div class="ffne-dm-modal-body">
                    <div class="ffne-dm-import-controls">
                        <div class="ffne-dm-form-row ffne-dm-field-row">
                            <label for="ffne-dm-import-format">Format</label>
                            <select id="ffne-dm-import-format" class="ffne-dm-input">
                                <option value="markdown">Markdown (.md)</option>
                                <option value="html">HTML (.html/.htm)</option>
                                <option value="docx">DOCX (.docx)</option>
                            </select>
                        </div>
                        <div class="ffne-dm-picker-group">
                            <button type="button" id="ffne-dm-browse-folder" class="ffne-dm-btn">Browse Folder</button>
                            <button type="button" id="ffne-dm-browse-files" class="ffne-dm-btn">Browse Files</button>
                            <span id="ffne-dm-import-selection" class="ffne-dm-selection-label">No Markdown files selected.</span>
                            <input id="ffne-dm-import-folder-input" class="ffne-dm-file-input" type="file" accept=".md,text/markdown" webkitdirectory multiple>
                            <input id="ffne-dm-import-files-input" class="ffne-dm-file-input" type="file" accept=".md,text/markdown" multiple>
                        </div>
                        <button type="button" id="ffne-dm-import-start" class="ffne-dm-btn" disabled>Import</button>
                    </div>
                    <div id="ffne-dm-import-preview" class="ffne-dm-summary">Selected format: Markdown (.md). Select a folder or Markdown files.</div>
                    <div id="ffne-dm-import-results" class="ffne-dm-import-results" hidden></div>
                    <div class="ffne-dm-footer">
                        <span id="ffne-dm-import-status" class="ffne-dm-run-status"></span>
                        <button type="button" class="ffne-dm-btn" data-ffne-action="close-import">Close</button>
                    </div>
                </div>
            </div>
        `;

        const folderButton = overlay.querySelector<HTMLButtonElement>('#ffne-dm-browse-folder');
        const filesButton = overlay.querySelector<HTMLButtonElement>('#ffne-dm-browse-files');
        const folderInput = overlay.querySelector<HTMLInputElement>('#ffne-dm-import-folder-input');
        const filesInput = overlay.querySelector<HTMLInputElement>('#ffne-dm-import-files-input');
        const formatSelect = overlay.querySelector<HTMLSelectElement>('#ffne-dm-import-format');
        const startButton = overlay.querySelector<HTMLButtonElement>('#ffne-dm-import-start');
        const preview = overlay.querySelector<HTMLElement>('#ffne-dm-import-preview');
        const status = overlay.querySelector<HTMLElement>('#ffne-dm-import-status');
        const selection = overlay.querySelector<HTMLElement>('#ffne-dm-import-selection');
        const results = overlay.querySelector<HTMLElement>('#ffne-dm-import-results');
        const title = overlay.querySelector<HTMLElement>('#ffne-dm-import-title');
        let selectedFormat = 'markdown' as BulkImportFormat;

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

        folderButton?.addEventListener('click', () => {
            if (!folderInput) return;
            folderInput.value = '';
            folderInput.click();
        });

        filesButton?.addEventListener('click', () => {
            if (!filesInput) return;
            filesInput.value = '';
            filesInput.click();
        });

        folderInput?.addEventListener('change', () => {
            updateSelectedFiles(folderInput, 'Folder');
        });

        filesInput?.addEventListener('change', () => {
            updateSelectedFiles(filesInput, 'Files');
        });

        formatSelect?.addEventListener('change', () => {
            resetSelectedFiles((formatSelect.value || 'markdown') as BulkImportFormat);
        });

        startButton?.addEventListener('click', async (e) => {
            const plan = this._bulkImportPlan;
            if (!plan || plan.hasBlockingErrors || plan.matchedCount === 0) return;

            const confirmed = confirm(
                `Bulk Import will replace ${plan.matchedCount} document(s) with matched ${_getBulkImportConfirmedLabel(plan.format)} files.\n\n` +
                'This cannot be undone from FFN Enhancements. Continue?'
            );
            if (!confirmed) return;

            await this.runBulkImport(e as MouseEvent, plan, status || undefined, results || undefined);
        });

        overlay.querySelector<HTMLButtonElement>('.ffne-dm-close')
            ?.addEventListener('click', () => this.closeBulkImportModal());
        overlay.querySelector<HTMLButtonElement>('[data-ffne-action="close-import"]')
            ?.addEventListener('click', () => this.closeBulkImportModal());

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

        const overlay = document.createElement('div');
        overlay.id = AO3_MODAL_ID;
        overlay.className = 'ffne-dm-overlay';
        overlay.innerHTML = `
            <div class="ffne-dm-modal ffne-dm-modal-wide" role="dialog" aria-modal="true" aria-labelledby="ffne-dm-ao3-title">
                <div class="ffne-dm-modal-header">
                    <h3 id="ffne-dm-ao3-title">Bulk Migrate to AO3</h3>
                    <button type="button" class="ffne-dm-close" aria-label="Close">x</button>
                </div>
                <div class="ffne-dm-modal-body">
                    <div class="ffne-dm-form-row">
                        <input id="ffne-dm-ao3-work-url" class="ffne-dm-input" type="url" placeholder="https://archiveofourown.org/works/123456789/">
                        <button type="button" id="ffne-dm-ao3-load" class="ffne-dm-btn">Load Chapters</button>
                    </div>
                    <label class="ffne-dm-checkbox">
                        <input id="ffne-dm-ao3-linebreaks" type="checkbox">
                        <span>Convert source line breaks for AO3</span>
                    </label>
                    <div class="ffne-dm-form-row ffne-dm-field-row">
                        <label for="ffne-dm-ao3-strip-marker">Strip Out Notes (optional)</label>
                        <input id="ffne-dm-ao3-strip-marker" class="ffne-dm-input" type="text" placeholder="Standalone line only, e.g. Notes:">
                    </div>
                    <div id="ffne-dm-ao3-summary" class="ffne-dm-summary ffne-dm-warning">
                        Enter an AO3 work URL, then load chapters. AO3 may open in a foreground tab. Complete any browser check or sign-in there and keep that tab open until migration finishes.
                    </div>
                    <div id="ffne-dm-ao3-mappings"></div>
                    <div id="ffne-dm-ao3-results" class="ffne-dm-import-results" hidden></div>
                    <div class="ffne-dm-footer">
                        <span id="ffne-dm-ao3-status" class="ffne-dm-run-status"></span>
                        <button type="button" id="ffne-dm-ao3-start" class="ffne-dm-btn" disabled>Migrate</button>
                        <button type="button" class="ffne-dm-btn" data-ffne-action="close-ao3">Close</button>
                    </div>
                </div>
            </div>
        `;

        const workUrlInput = overlay.querySelector<HTMLInputElement>('#ffne-dm-ao3-work-url');
        const loadButton = overlay.querySelector<HTMLButtonElement>('#ffne-dm-ao3-load');
        const linebreakCheckbox = overlay.querySelector<HTMLInputElement>('#ffne-dm-ao3-linebreaks');
        const stripMarkerInput = overlay.querySelector<HTMLInputElement>('#ffne-dm-ao3-strip-marker');
        const summary = overlay.querySelector<HTMLElement>('#ffne-dm-ao3-summary');
        const mappings = overlay.querySelector<HTMLElement>('#ffne-dm-ao3-mappings');
        const results = overlay.querySelector<HTMLElement>('#ffne-dm-ao3-results');
        const status = overlay.querySelector<HTMLElement>('#ffne-dm-ao3-status');
        const startButton = overlay.querySelector<HTMLButtonElement>('#ffne-dm-ao3-start');

        loadButton?.addEventListener('click', async () => {
            const normalizedWorkUrl = Ao3BridgeClient.normalizeWorkUrl(workUrlInput?.value || '');
            if (!normalizedWorkUrl) {
                log('AO3 chapter load blocked by invalid work URL.', { input: workUrlInput?.value || '' });
                if (summary) {
                    summary.className = 'ffne-dm-summary ffne-dm-error';
                    summary.textContent = 'Enter a valid AO3 work URL.';
                }
                if (startButton) startButton.disabled = true;
                if (mappings) mappings.innerHTML = '';
                if (status) status.textContent = '';
                _renderAo3MigrationFailures(results, []);
                return;
            }

            if (status) status.textContent = 'Opening AO3 if needed and loading chapters...';
            log('Loading AO3 chapter index.', { workUrl: normalizedWorkUrl });
            const response = await Ao3BridgeClient.fetchChapterIndex(normalizedWorkUrl);
            if (!response.ok) {
                log('AO3 chapter index load failed.', {
                    workUrl: normalizedWorkUrl,
                    reason: response.reason,
                });
                if (summary) {
                    summary.className = 'ffne-dm-summary ffne-dm-error';
                    summary.textContent = response.reason || 'Could not load AO3 chapters.';
                }
                if (mappings) mappings.innerHTML = '';
                if (startButton) startButton.disabled = true;
                if (status) status.textContent = '';
                _renderAo3MigrationFailures(results, []);
                return;
            }

            const sourceItems = _collectBulkItems();
            this._ao3MigrationState = {
                normalizedWorkUrl,
                chapters: response.chapters,
                sourceItems,
                rows: _createAo3MigrationRows(sourceItems, response.chapters),
                convertLineBreaks: !!linebreakCheckbox?.checked,
                stripNotesMarker: stripMarkerInput?.value.trim() || '',
            };
            log('AO3 chapter index loaded and migration rows prepared.', {
                workUrl: normalizedWorkUrl,
                chapterCount: response.chapters.length,
                sourceDocCount: sourceItems.length,
                convertLineBreaks: !!linebreakCheckbox?.checked,
                stripNotesEnabled: !!stripMarkerInput?.value.trim(),
            });
            if (status) status.textContent = `Loaded ${response.chapters.length} AO3 chapter(s).`;
            _renderAo3MigrationFailures(results, []);
            this._refreshAo3MigrationPreview(summary || null, mappings || null, startButton || null);
        });

        linebreakCheckbox?.addEventListener('change', () => {
            if (!this._ao3MigrationState) return;
            this._ao3MigrationState.convertLineBreaks = !!linebreakCheckbox.checked;
            this._refreshAo3MigrationPreview(summary || null, mappings || null, startButton || null);
        });

        stripMarkerInput?.addEventListener('input', () => {
            if (!this._ao3MigrationState) return;
            this._ao3MigrationState.stripNotesMarker = stripMarkerInput.value.trim();
            this._refreshAo3MigrationPreview(summary || null, mappings || null, startButton || null);
        });

        startButton?.addEventListener('click', async (e) => {
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
            this._refreshAo3MigrationPreview(summary || null, mappings || null, startButton || null);
        });

        overlay.querySelector<HTMLButtonElement>('.ffne-dm-close')
            ?.addEventListener('click', () => this.closeAo3MigrationModal());
        overlay.querySelector<HTMLButtonElement>('[data-ffne-action="close-ao3"]')
            ?.addEventListener('click', () => this.closeAo3MigrationModal());

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
        const duplicateHtml = duplicateLabels.length > 0
            ? `<strong>Duplicate source docs:</strong> ${visibleDuplicateLabels.map(_escapeHtml).join(', ')}${duplicateLabels.length > visibleDuplicateLabels.length ? `, and ${duplicateLabels.length - visibleDuplicateLabels.length} more` : ''}`
            : '';

        summaryEl.className = summaryClass;
        summaryEl.innerHTML = `
            <div>
                <strong>${plan.chapters.length}</strong> AO3 chapter(s),
                <strong>${state.sourceItems.length}</strong> source doc(s),
                <strong>${plan.mappedCount}</strong> mapped,
                <strong>${plan.skippedCount}</strong> skipped.
            </div>
            ${plan.stripNotesMarker ? `<div class="ffne-dm-summary-detail"><strong>Strip marker:</strong> ${_escapeHtml(plan.stripNotesMarker)}</div>` : ''}
            ${duplicateHtml ? `<div class="ffne-dm-summary-detail">${duplicateHtml}</div>` : ''}
        `;

        const optionsHtml = state.sourceItems.map(item => `
            <option value="${_escapeHtml(item.docId)}">${_escapeHtml(item.docName)}</option>
        `).join('');
        const rowsHtml = plan.rows.map((row, index) => `
            <tr data-row-index="${index}">
                <td>${_escapeHtml(row.chapter.label)}</td>
                <td>
                    <select class="ffne-dm-select" data-ffne-ao3-source="${index}">
                        <option value="">Skip this AO3 chapter</option>
                        ${optionsHtml}
                    </select>
                </td>
                <td>${_escapeHtml(row.mappingSource)}</td>
                <td class="ffne-dm-status-${row.status}">${_escapeHtml(row.status)}</td>
            </tr>
        `).join('');

        const tableBodyHtml = plan.rows.length > 0
            ? rowsHtml
            : '<tr><td colspan="4">No AO3 chapters found.</td></tr>';

        mappingsEl.innerHTML = `
            <div class="ffne-dm-preview-scroll">
                <table class="ffne-dm-preview" contenteditable="false">
                    <thead>
                        <tr>
                            <th>AO3 Chapter</th>
                            <th>Source Doc</th>
                            <th>Mapping Source</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>${tableBodyHtml}</tbody>
                </table>
            </div>
        `;

        plan.rows.forEach((row, index) => {
            const rowEl = mappingsEl.querySelector<HTMLTableRowElement>(`tr[data-row-index="${index}"]`);
            row.modalRow = rowEl;
            const select = mappingsEl.querySelector<HTMLSelectElement>(`select[data-ffne-ao3-source="${index}"]`);
            if (select) {
                select.value = row.selectedSourceItem?.docId || '';
                select.addEventListener('change', () => {
                    if (!this._ao3MigrationState) return;
                    _setManualAo3SourceSelection(this._ao3MigrationState.rows, this._ao3MigrationState.sourceItems, index, select.value);
                    this._refreshAo3MigrationPreview(summaryEl, mappingsEl, startButton);
                });
            }
        });
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

        const blockedHtml = plan.blockedFiles.length > 0
            ? `<div><strong>Blocked:</strong> ${plan.blockedFiles.map(_escapeHtml).join(', ')}</div>`
            : '';
        const duplicateHtml = plan.duplicateFileNames.length > 0
            ? `<div><strong>Duplicates:</strong> ${plan.duplicateFileNames.map(_escapeHtml).join(', ')}</div>`
            : '';
        const duplicateDocHtml = plan.duplicateDocNames.length > 0
            ? `<div><strong>Conflicting matches:</strong> ${plan.duplicateDocNames.map(_escapeHtml).join(', ')}</div>`
            : '';
        const ignoredHtml = plan.ignoredFiles.length > 0
            ? `<div><strong>Ignored:</strong> ${plan.ignoredFiles.slice(0, 8).map(_escapeHtml).join(', ')}${plan.ignoredFiles.length > 8 ? '...' : ''}</div>`
            : '';

        const rowsHtml = plan.rows.map(row => `
            <tr data-row-doc-id="${_escapeHtml(row.docId)}" data-row-file="${_escapeHtml(row.expectedFileName)}">
                <td>${_escapeHtml(row.docName)}</td>
                <td>${_escapeHtml(row.expectedFileName)}</td>
                <td data-ffne-status></td>
            </tr>
        `).join('');

        preview.className = summaryClass;
        preview.innerHTML = `
            <div>
                <strong>Format:</strong> ${_escapeHtml(formatOption.label)}
            </div>
            <div>
                <strong>${plan.matchedCount}</strong> matched,
                <strong>${plan.missingCount}</strong> missing in DocManager,
                <strong>${plan.duplicateFileNames.length + plan.duplicateDocNames.length}</strong> duplicate,
                <strong>${plan.ignoredFiles.length}</strong> ignored.
            </div>
            ${blockedHtml}
            ${duplicateHtml}
            ${duplicateDocHtml}
            ${ignoredHtml}
            <table class="ffne-dm-preview" contenteditable="false">
                <thead>
                    <tr>
                        <th>Doc</th>
                        <th>Selected File</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml || `<tr><td colspan="3">No top-level ${_escapeHtml(formatOption.fileLabel)} files found.</td></tr>`}</tbody>
            </table>
        `;

        preview.querySelectorAll<HTMLTableRowElement>('tr[data-row-file]').forEach(rowEl => {
            const expectedFileName = rowEl.getAttribute('data-row-file') || '';
            const row = plan.rows.find(candidate => candidate.expectedFileName === expectedFileName);
            if (!row) return;
            row.modalRow = rowEl;
            _renderBulkImportRowStatus(row);
        });
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
            copyLink.style.textDecoration = "none";
            copyLink.style.whiteSpace = "nowrap";
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
            exportLink.style.textDecoration = "none";
            exportLink.style.whiteSpace = "nowrap";
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
            refreshLink.style.textDecoration = "none";
            refreshLink.style.whiteSpace = "nowrap";
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
     * so changes made via the Tampermonkey menu take effect on the next export.
     * @param btnElement - The button clicked (for UI feedback).
     * @param docId - The FFN Document ID.
     * @param title - The title of the document.
     */
    runSingleExport: async function (btnElement: HTMLElement, docId: string, title: string) {
        const log = Core.getLogger(this.MODULE_NAME, 'runSingleExport');
        const originalText = btnElement.innerText;

        btnElement.innerText = "...";
        btnElement.style.color = "gray";
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
            setTimeout(() => {
                btnElement.innerText = originalText;
                btnElement.style.color = "";
                btnElement.style.cursor = "pointer";
            }, 2000);
        } else {
            btnElement.innerText = "Err";
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
        btnElement.style.color = "gray";
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
                btnElement.style.color = "green";
                log(`Clipboard export successful for "${title}"`);
            } else {
                btnElement.innerText = "Err";
                btnElement.style.color = "red";
                log(`Clipboard export failed for "${title}"`);
            }
        } else {
            btnElement.innerText = "Err";
            btnElement.style.color = "red";
            log(`Failed to fetch document content for clipboard export.`);
        }

        setTimeout(() => {
            btnElement.innerText = originalText;
            btnElement.title = originalTitle;
            btnElement.style.color = "";
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
        btnElement.style.color = "gray";
        btnElement.style.cursor = "wait";

        log(`Starting refresh for ${title} (${docId})`);
        const success = await DocFetchService.refreshPrivateDoc(docId, title);

        if (success) {
            btnElement.innerText = "✓";
            btnElement.style.color = "green";

            // Update the Life column to show 365 days
            const row = btnElement.closest('tr') as HTMLTableRowElement;
            if (row) {
                this.updateLifeColumn(row, `single refresh: ${title}`);
            }

            setTimeout(() => {
                btnElement.innerText = originalText;
                btnElement.style.color = "";
                btnElement.style.cursor = "pointer";
            }, 2000);
        } else {
            btnElement.innerText = "✗";
            btnElement.style.color = "red";
            log("Failed to refresh document.");
            setTimeout(() => {
                btnElement.innerText = originalText;
                btnElement.style.color = "";
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
        const zip = new JSZip();
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
                const originalBg = item.row.style.backgroundColor;
                item.row.style.backgroundColor = SEMANTIC.RUNNING_BG;
                item.row.style.transition = 'background-color 0.3s ease';
                try {
                    const content = format === DocDownloadFormat.DOCX || format === DocDownloadFormat.HTML
                        ? await DocFetchService.fetchPrivateDocAsHtml(item.docId, item.title)
                        : await DocFetchService.fetchAndConvertPrivateDoc(item.docId, item.title);
                    if (content) {
                        const transformed = applyExportTransforms(content, format);
                        if (format === DocDownloadFormat.DOCX) {
                            const docxBlob = await DocxBuilder.build(transformed, item.title);
                            zip.file(`${item.title}.docx`, docxBlob, { date: new Date() });
                        } else {
                            zip.file(`${item.title}.${format}`, transformed, { date: new Date() });
                        }
                        return true;
                    }
                    return false;
                } finally {
                    item.row.style.backgroundColor = originalBg;
                }
            },
            onPermanentFailure: (item) => {
                zip.file(`ERROR_${item.title}.txt`, `Failed to retrieve content for DocID ${item.docId} after multiple attempts.`);
                failures.push({ docName: item.docName, reason: `Failed to retrieve content for DocID ${item.docId}.` });
                failedItems.push(item);
            },
            onFinalize: async ({ successCount, totalCount }) => {
                if (successCount > 0) {
                    btn.innerText = "Zipping...";
                    if (statusEl) statusEl.textContent = 'Zipping...';
                    log(`Zipping ${successCount} documents`);
                    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
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
                const originalBg = item.row.style.backgroundColor;
                item.row.style.backgroundColor = SEMANTIC.RUNNING_BG;
                item.row.style.transition = 'background-color 0.3s ease';
                try {
                    return await DocFetchService.refreshPrivateDoc(item.docId, item.title);
                } finally {
                    item.row.style.backgroundColor = originalBg;
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

                const originalTableBg = sourceItem.row.style.backgroundColor;
                const originalModalBg = row.modalRow?.style.backgroundColor || '';
                sourceItem.row.style.backgroundColor = SEMANTIC.RUNNING_BG;
                sourceItem.row.style.transition = 'background-color 0.3s ease';
                if (row.modalRow) {
                    row.modalRow.style.backgroundColor = SEMANTIC.RUNNING_BG;
                    row.modalRow.style.transition = 'background-color 0.3s ease';
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
                    sourceItem.row.style.backgroundColor = originalTableBg;
                    if (row.modalRow) {
                        row.modalRow.style.backgroundColor = originalModalBg;
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
            retryBtn.className = 'ffne-dm-action-btn';
            retryBtn.style.cssText = 'display:block; margin-top:12px;';
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

                const originalBg = item.row.style.backgroundColor;
                item.row.style.backgroundColor = SEMANTIC.RUNNING_BG;
                item.row.style.transition = 'background-color 0.3s ease';

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
                    item.row.style.backgroundColor = originalBg;
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
            retryBtn.className = 'ffne-dm-btn';
            retryBtn.style.cssText = 'display:block; margin-top:8px;';
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
