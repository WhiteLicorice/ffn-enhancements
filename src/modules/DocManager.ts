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
import { applyExportTransforms } from '../utils/exportTransform';
import { writeToClipboard } from '../utils/clipboard';
import { SimpleMarkdownParser } from './SimpleMarkdownParser';
import { runBulkOperation } from '../utils/runBulkOperation';

const ADVANCED_DRAWER_ID = 'ffne-docmanager-advanced-drawer';
const ADVANCED_MODAL_ID = 'ffne-docmanager-advanced-modal';
const IMPORT_MODAL_ID = 'ffne-docmanager-import-modal';
const ADVANCED_STYLE_ID = 'ffne-docmanager-advanced-styles';
const MARKDOWN_EXTENSION = '.md';
const BLOCKED_IMPORT_EXTENSIONS = new Set(['.htm', '.html', '.docx']);

type BulkImportRowStatus = 'matched' | 'missing' | 'duplicate';

interface BulkImportPreviewRow {
    docId: string;
    docName: string;
    expectedFileName: string;
    status: BulkImportRowStatus;
    file: File | null;
}

interface BulkImportPlan {
    totalFiles: number;
    totalDocs: number;
    matchedCount: number;
    missingCount: number;
    duplicateFileNames: string[];
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

function _escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _buildBulkImportPlan(files: File[], items: IBulkItem[] = _collectBulkItems()): BulkImportPlan {
    const markdownFilesByName = new Map<string, File[]>();
    const blockedFiles: string[] = [];
    const ignoredFiles: string[] = [];
    const itemByExpectedFileName = new Map<string, IBulkItem>();

    for (const item of items) {
        itemByExpectedFileName.set(`${item.docName}${MARKDOWN_EXTENSION}`, item);
    }

    for (const file of files) {
        const displayPath = _getFileDisplayPath(file);
        const fileName = _getPathFileName(displayPath);
        const extension = _getLowerExtension(fileName);

        if (BLOCKED_IMPORT_EXTENSIONS.has(extension)) {
            blockedFiles.push(displayPath);
            continue;
        }

        const topLevelFileName = _getTopLevelFileName(file);
        if (!topLevelFileName || extension !== MARKDOWN_EXTENSION) {
            ignoredFiles.push(displayPath);
            continue;
        }

        const existing = markdownFilesByName.get(topLevelFileName) || [];
        existing.push(file);
        markdownFilesByName.set(topLevelFileName, existing);
    }

    const duplicateFileNames = Array.from(markdownFilesByName.entries())
        .filter(([, matchedFiles]) => matchedFiles.length > 1)
        .map(([fileName]) => fileName);

    const duplicateSet = new Set(duplicateFileNames);
    const rows: BulkImportPreviewRow[] = [];
    const fileByDocId = new Map<string, File>();
    let matchedCount = 0;
    let missingCount = 0;

    for (const [fileName, matchedFiles] of markdownFilesByName) {
        const item = itemByExpectedFileName.get(fileName);
        const targetDocName = fileName.slice(0, -MARKDOWN_EXTENSION.length);

        if (duplicateSet.has(fileName)) {
            rows.push({
                docId: item?.docId || '',
                docName: item?.docName || targetDocName,
                expectedFileName: fileName,
                status: 'duplicate',
                file: null,
            });
            continue;
        }

        if (item && matchedFiles.length === 1) {
            rows.push({
                docId: item.docId,
                docName: item.docName,
                expectedFileName: fileName,
                status: 'matched',
                file: matchedFiles[0],
            });
            fileByDocId.set(item.docId, matchedFiles[0]);
            matchedCount++;
            continue;
        }

        rows.push({
            docId: '',
            docName: targetDocName,
            expectedFileName: fileName,
            status: 'missing',
            file: matchedFiles[0] || null,
        });
        missingCount++;
    }

    return {
        totalFiles: files.length,
        totalDocs: items.length,
        matchedCount,
        missingCount,
        duplicateFileNames,
        blockedFiles,
        ignoredFiles,
        rows,
        fileByDocId,
        hasBlockingErrors: blockedFiles.length > 0 || duplicateFileNames.length > 0,
    };
}

function _sanitizeImportHtml(html: string): string {
    const doc = new DOMParser().parseFromString(`<div id="ffne-import-root">${html}</div>`, 'text/html');
    const root = doc.getElementById('ffne-import-root');
    if (!root) return '';

    root.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(el => el.remove());
    root.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
                return;
            }
            if ((name === 'href' || name === 'src') && /^(javascript|data):/.test(value)) {
                el.removeAttribute(attr.name);
            }
        });
    });

    return root.innerHTML;
}

function _markdownToImportHtml(markdown: string): string {
    return _sanitizeImportHtml(SimpleMarkdownParser.parse(markdown));
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
    _bulkImportPlan: null as BulkImportPlan | null,

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
                border: 1px solid #7892ad;
                background: #f0f4f8;
                color: #234d73;
                font-family: Verdana, Arial, sans-serif;
                font-size: 12px;
                line-height: 18px;
                padding: 4px 10px;
                border-radius: 3px;
                cursor: pointer;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
            }
            .ffne-dm-btn:hover {
                background: #e3edf7;
                color: #123a5a;
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
                box-shadow: 0 -1px 6px rgba(0, 0, 0, 0.22);
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
                color: #777;
                cursor: default;
                opacity: 0.65;
            }
            .ffne-dm-overlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                background: rgba(0, 0, 0, 0.35);
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
                background: #fff;
                border: 1px solid #7892ad;
                box-shadow: 0 3px 18px rgba(0, 0, 0, 0.35);
            }
            .ffne-dm-modal-sm {
                width: min(460px, calc(100vw - 32px));
            }
            .ffne-dm-modal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                background: #336699;
                color: #fff;
                padding: 7px 10px;
                border-bottom: 1px solid #254d73;
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
                color: #fff;
                cursor: pointer;
                font-size: 18px;
                line-height: 18px;
                padding: 0 4px;
            }
            .ffne-dm-modal-body {
                padding: 12px;
                color: #333;
                font-size: 12px;
            }
            .ffne-dm-routines {
                display: grid;
                gap: 8px;
            }
            .ffne-dm-routine {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                border: 1px solid #d8d8d8;
                background: #fafafa;
                padding: 8px;
            }
            .ffne-dm-routine-title {
                font-weight: 700;
                color: #333;
            }
            .ffne-dm-import-controls {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 10px;
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
                color: #555;
                font-size: 11px;
            }
            .ffne-dm-summary {
                margin: 8px 0;
                padding: 7px 8px;
                background: #f7f9fb;
                border: 1px solid #d8e2ec;
            }
            .ffne-dm-warning {
                color: #8a3b00;
                background: #fff8e8;
                border-color: #e8c98a;
            }
            .ffne-dm-error {
                color: #8b0000;
                background: #fff0f0;
                border-color: #d8a0a0;
            }
            .ffne-dm-preview {
                width: 100%;
                border-collapse: collapse;
                margin-top: 8px;
                cursor: default;
                user-select: none;
            }
            .ffne-dm-preview th {
                background: #f0f4f8;
                color: #333;
                border: 1px solid #c8d6e4;
                padding: 5px 6px;
                text-align: left;
                cursor: default;
            }
            .ffne-dm-preview td {
                border: 1px solid #ddd;
                padding: 5px 6px;
                vertical-align: top;
                cursor: default;
            }
            .ffne-dm-status-matched { color: #236423; font-weight: 700; }
            .ffne-dm-status-missing { color: #777; }
            .ffne-dm-status-duplicate { color: #8b0000; font-weight: 700; }
            .ffne-dm-footer {
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 8px;
                margin-top: 10px;
            }
            .ffne-dm-run-status {
                margin-right: auto;
                color: #555;
            }
            .ffne-dm-import-results {
                margin-top: 10px;
                padding: 7px 8px;
                color: #8b0000;
                background: #fff0f0;
                border: 1px solid #d8a0a0;
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
            <div class="ffne-dm-modal ffne-dm-modal-sm" role="dialog" aria-modal="true" aria-labelledby="ffne-dm-advanced-title">
                <div class="ffne-dm-modal-header">
                    <h3 id="ffne-dm-advanced-title">Advanced Routines</h3>
                    <button type="button" class="ffne-dm-close" aria-label="Close">x</button>
                </div>
                <div class="ffne-dm-modal-body">
                    <div class="ffne-dm-routines">
                        <div class="ffne-dm-routine">
                            <span class="ffne-dm-routine-title">Bulk Export</span>
                            <button type="button" class="ffne-dm-btn" data-ffne-action="bulk-export">Run</button>
                        </div>
                        <div class="ffne-dm-routine">
                            <span class="ffne-dm-routine-title">Bulk Refresh</span>
                            <button type="button" class="ffne-dm-btn" data-ffne-action="bulk-refresh">Run</button>
                        </div>
                        <div class="ffne-dm-routine">
                            <span class="ffne-dm-routine-title">Bulk Import</span>
                            <button type="button" class="ffne-dm-btn" data-ffne-action="bulk-import">Open</button>
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
            ?.addEventListener('click', (e) => this.runBulkExport(e as MouseEvent));

        overlay.querySelector<HTMLButtonElement>('[data-ffne-action="bulk-refresh"]')
            ?.addEventListener('click', (e) => this.runBulkRefresh(e as MouseEvent));

        overlay.querySelector<HTMLButtonElement>('[data-ffne-action="bulk-import"]')
            ?.addEventListener('click', () => {
                this.closeAdvancedRoutinesModal();
                this.openBulkImportModal();
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
                    <h3 id="ffne-dm-import-title">Bulk Import Markdown</h3>
                    <button type="button" class="ffne-dm-close" aria-label="Close">x</button>
                </div>
                <div class="ffne-dm-modal-body">
                    <div class="ffne-dm-import-controls">
                        <div class="ffne-dm-picker-group">
                            <button type="button" id="ffne-dm-browse-folder" class="ffne-dm-btn">Browse Folder</button>
                            <button type="button" id="ffne-dm-browse-files" class="ffne-dm-btn">Browse Files</button>
                            <span id="ffne-dm-import-selection" class="ffne-dm-selection-label">No files selected.</span>
                            <input id="ffne-dm-import-folder-input" class="ffne-dm-file-input" type="file" accept=".md,text/markdown" webkitdirectory multiple>
                            <input id="ffne-dm-import-files-input" class="ffne-dm-file-input" type="file" accept=".md,text/markdown" multiple>
                        </div>
                        <button type="button" id="ffne-dm-import-start" class="ffne-dm-btn" disabled>Import</button>
                    </div>
                    <div id="ffne-dm-import-preview" class="ffne-dm-summary">Select a folder or Markdown files.</div>
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
        const startButton = overlay.querySelector<HTMLButtonElement>('#ffne-dm-import-start');
        const preview = overlay.querySelector<HTMLElement>('#ffne-dm-import-preview');
        const status = overlay.querySelector<HTMLElement>('#ffne-dm-import-status');
        const selection = overlay.querySelector<HTMLElement>('#ffne-dm-import-selection');
        const results = overlay.querySelector<HTMLElement>('#ffne-dm-import-results');

        const updateSelectedFiles = (input: HTMLInputElement, sourceLabel: string) => {
            const files = Array.from(input.files || []);
            const plan = _buildBulkImportPlan(files);
            this._bulkImportPlan = plan;
            if (preview && startButton) {
                this._renderBulkImportPreview(preview, startButton, plan);
            }
            _renderBulkImportFailures(results, []);
            if (selection) {
                const count = files.length;
                selection.textContent = count === 1
                    ? `${sourceLabel}: 1 file selected.`
                    : `${sourceLabel}: ${count} files selected.`;
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

        startButton?.addEventListener('click', async (e) => {
            const plan = this._bulkImportPlan;
            if (!plan || plan.hasBlockingErrors || plan.matchedCount === 0) return;

            const confirmed = confirm(
                `Bulk Import will replace ${plan.matchedCount} document(s) with matched Markdown files.\n\n` +
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

    _renderBulkImportPreview: function (
        preview: HTMLElement,
        startButton: HTMLButtonElement,
        plan: BulkImportPlan,
    ) {
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
        const ignoredHtml = plan.ignoredFiles.length > 0
            ? `<div><strong>Ignored:</strong> ${plan.ignoredFiles.slice(0, 8).map(_escapeHtml).join(', ')}${plan.ignoredFiles.length > 8 ? '...' : ''}</div>`
            : '';

        const rowsHtml = plan.rows.map(row => `
            <tr>
                <td>${_escapeHtml(row.docName)}</td>
                <td>${_escapeHtml(row.expectedFileName)}</td>
                <td class="ffne-dm-status-${row.status}">${row.status}</td>
            </tr>
        `).join('');

        preview.className = summaryClass;
        preview.innerHTML = `
            <div>
                <strong>${plan.matchedCount}</strong> matched,
                <strong>${plan.missingCount}</strong> missing in DocManager,
                <strong>${plan.duplicateFileNames.length}</strong> duplicate,
                <strong>${plan.ignoredFiles.length}</strong> ignored.
            </div>
            ${blockedHtml}
            ${duplicateHtml}
            ${ignoredHtml}
            <table class="ffne-dm-preview" contenteditable="false">
                <thead>
                    <tr>
                        <th>Doc</th>
                        <th>Selected File</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml || '<tr><td colspan="3">No top-level Markdown files found.</td></tr>'}</tbody>
            </table>
        `;
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
    runBulkExport: async function (e: MouseEvent) {
        const log = Core.getLogger(this.MODULE_NAME, 'runBulkExport');
        const format = SettingsManager.get('docDownloadFormat');
        // Has to be immediately available inside this scope
        // not in the async-inside-sync blocks below
        const btn = e.currentTarget as HTMLButtonElement;
        log(`Bulk export format: ${format}`);
        const zip = new JSZip();

        await _runBulkOperation(e, {
            verb: 'Export',
            processItem: async (item) => {
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
            },
            onPermanentFailure: (item) => {
                zip.file(`ERROR_${item.title}.txt`, `Failed to retrieve content for DocID ${item.docId} after multiple attempts.`);
            },
            onFinalize: async ({ successCount, retriedItems }) => {
                if (successCount > 0 || retriedItems.length > 0) {
                    btn.innerText = "Zipping...";
                    log(`Zipping ${successCount} documents`);
                    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
                    const timestamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19);
                    saveAs(blob, `ffn_${timestamp}.zip`);
                    btn.innerText = "Done";
                } else {
                    btn.innerText = "Empty";
                }
            },
        });
    },

    /**
     * Handles the bulk refresh of all visible documents.
     * Delegates to _runBulkOperation for the two-pass retry orchestration.
     */
    runBulkRefresh: async function (e: MouseEvent) {
        const log = Core.getLogger(this.MODULE_NAME, 'runBulkRefresh');
        const btn = e.currentTarget as HTMLButtonElement;

        await _runBulkOperation(e, {
            verb: 'Refresh',
            filterRows: (items) => {
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
                    alert('All documents already have 365 days life remaining. No refresh needed!');
                }
                return filtered;
            },
            preBatch: (totalCount) => {
                alert(
                    `Bulk Refresh will start for ${totalCount} document(s).\n\n` +
                    'Please DO NOT CLOSE this tab until the refresh is complete.\n\n' +
                    'The refresh runs silently in the background — you will be notified when it is done.'
                );
            },
            processItem: async (item) => {
                const originalBg = item.row.style.backgroundColor;
                item.row.style.backgroundColor = '#90EE90';
                item.row.style.transition = 'background-color 0.3s ease';

                const success = await DocFetchService.refreshPrivateDoc(item.docId, item.title);

                item.row.style.backgroundColor = originalBg;
                return success;
            },
            onItemSuccess: (item, pass) => {
                DocManager.updateLifeColumn(item.row, `bulk pass ${pass}: ${item.title}`);
            },
            onFinalize: ({ successCount, totalCount, retriedItems: _retriedItems }) => {
                if (successCount === totalCount) {
                    btn.innerText = "All Done!";
                    log(`Successfully refreshed all ${successCount} documents`);
                    alert(`Bulk Refresh complete! All ${successCount} document(s) refreshed successfully.`);
                } else if (successCount > 0) {
                    btn.innerText = `${successCount}/${totalCount}`;
                    log(`Refreshed ${successCount} of ${totalCount} documents`);
                    alert(`Bulk Refresh complete. ${successCount} of ${totalCount} document(s) refreshed successfully.\n\nSome documents could not be refreshed — check the console for details.`);
                } else {
                    btn.innerText = "Failed";
                    log(`Failed to refresh any documents`);
                    alert(`Bulk Refresh failed. No documents could be refreshed.\n\nPlease check the console for details and try again.`);
                }
            },
        });
    },

    /**
     * Handles Markdown-only bulk import for matched DocManager rows.
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
                if (!statusEl) return;
                const verb = pass === 2 ? 'Retrying' : 'Importing';
                statusEl.textContent = `${verb} ${index}/${total}: ${item.docName} from ${fileLabelFor(item)}...`;
            },
            processItem: async (item) => {
                const file = plan.fileByDocId.get(item.docId);
                if (!file) {
                    setFailure(item, 'No matched Markdown file was found.');
                    return false;
                }

                const originalBg = item.row.style.backgroundColor;
                item.row.style.backgroundColor = '#fff4c2';
                item.row.style.transition = 'background-color 0.3s ease';

                try {
                    const markdown = await _readFileAsText(file);
                    if (!markdown.trim()) {
                        log(`Skipping "${item.docName}" because matched file is empty.`);
                        setFailure(item, 'Matched Markdown file is empty.');
                        return false;
                    }

                    const html = _markdownToImportHtml(markdown);
                    if (!html.trim()) {
                        log(`Skipping "${item.docName}" because Markdown conversion produced no HTML.`);
                        setFailure(item, 'Markdown conversion produced no importable HTML.');
                        return false;
                    }

                    const result = await DocFetchService.replacePrivateDocContentWithResult(item.docId, item.title, html);
                    if (!result.ok) {
                        setFailure(item, result.reason || 'FFN did not confirm the save.');
                        return false;
                    }

                    failureReasons.delete(item.docId);
                    return true;
                } catch (err) {
                    log(`Failed to import "${item.docName}".`, err);
                    const reason = err instanceof Error ? err.message : String(err);
                    setFailure(item, `Unexpected error: ${reason}`);
                    return false;
                } finally {
                    item.row.style.backgroundColor = originalBg;
                }
            },
            onItemSuccess: (item, pass) => {
                DocManager.updateLifeColumn(item.row, `bulk import pass ${pass}: ${item.title}`);
            },
            onPermanentFailure: (item) => {
                log(`Permanent import failure for "${item.docName}".`);
                failures.push({
                    docName: item.docName,
                    fileName: fileLabelFor(item),
                    reason: failureReasons.get(item.docId) || 'Import failed after retry.',
                });
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
    },

    // Exported for tests — verifies button-reference lifecycle in onFinalize callbacks.
    _runBulkOperation,
    _buildBulkImportPlan,
    _getTopLevelFileName,
    _markdownToImportHtml,
    _sanitizeImportHtml,
};
