// modules/DocManager.ts

import { Core } from './Core';
import { DocFetchService } from '../services/DocFetchService';
import { Elements } from '../enums/Elements';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { SettingsManager } from './SettingsManager';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DocIframeHandler } from './DocIframeHandler';
import { IBulkOperationConfig, IBulkItem } from '../interfaces/IBulkOperationConfig';

/**
 * Two-pass retry orchestrator for bulk operations.
 * Handles: row extraction, progress UI, two-pass retry with delays, error handling, button reset.
 * Operation-specific logic injected via callbacks.
 */
async function _runBulkOperation(e: MouseEvent, config: IBulkOperationConfig): Promise<void> {
    const log = Core.getLogger(DocManager.MODULE_NAME, '_runBulkOperation');
    const { verb, processItem, onItemSuccess, onPermanentFailure, preBatch, onFinalize } = config;

    log(`${verb} initiated.`);
    const btn = e.currentTarget as HTMLButtonElement;

    if (!Core.getElement(Elements.DOC_TABLE)) {
        log("Table not found.");
        return;
    }

    const allRows = Core.getElements(Elements.DOC_TABLE_BODY_ROWS);

    let items: IBulkItem[] = [];
    for (const row of allRows) {
        const editLink = row.querySelector('a[href*="docid="]') as HTMLAnchorElement;
        if (!editLink) continue;
        const match = editLink.href.match(/docid=(\d+)/);
        if (!match) continue;
        items.push({
            docId: match[1],
            title: (row as HTMLTableRowElement).cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-'),
            row: row as HTMLTableRowElement,
        });
    }

    if (config.filterRows) {
        items = config.filterRows(items);
    }

    if (items.length === 0) {
        log("No documents to process.");
        return;
    }

    if (preBatch) preBatch(items.length);

    const originalText = btn.innerText;
    btn.disabled = true;
    btn.style.cursor = "wait";
    btn.style.opacity = "1";

    let successCount = 0;
    const retriedItems: IBulkItem[] = [];

    try {
        // PASS 1: Initial attempt
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            btn.innerText = `${i + 1}/${items.length}`;

            await new Promise(r => setTimeout(r, SettingsManager.get('bulkExportDelayMs')));

            if (await processItem(item)) {
                successCount++;
                if (onItemSuccess) onItemSuccess(item, 1);
            } else {
                retriedItems.push(item);
            }
        }

        // PASS 2: Retry failures after cooldown
        if (retriedItems.length > 0) {
            log(`Pass 1 done. ${retriedItems.length} items failed. Cooling...`);
            btn.innerText = "Cooling...";
            await new Promise(r => setTimeout(r, SettingsManager.get('bulkCooldownMs')));

            for (let i = 0; i < retriedItems.length; i++) {
                const item = retriedItems[i];
                btn.innerText = `Retry ${i + 1}/${retriedItems.length}`;

                await new Promise(r => setTimeout(r, SettingsManager.get('bulkRetryDelayMs')));

                if (await processItem(item)) {
                    successCount++;
                    if (onItemSuccess) onItemSuccess(item, 2);
                } else {
                    log(`Pass 2 Permanent Failure for ${item.title}`);
                    if (onPermanentFailure) onPermanentFailure(item);
                }
            }
        }

        // Finalization
        if (onFinalize) {
            await onFinalize({ successCount, totalCount: items.length, retriedItems });
        }
    } catch (error) {
        log(`Error during bulk ${verb}.`, error);
        btn.innerText = "Error";
    } finally {
        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.cursor = "pointer";
            btn.style.opacity = "0.6";
        }, 3000);
    }
}

/**
 * Module responsible for enhancing the Document Manager page (`/docs/docs.php`).
 */
export const DocManager = {
    MODULE_NAME: 'doc-manager',

    /** Cache for dynamically-resolved Life column index. null = not resolved yet. */
    _lifeColIdx: null as number | null,

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
        this.injectBulkButton();
        this.injectRefreshAllButton();
        this.injectTableColumn();
    },

    /**
     * Injects the floating "Download All" button into the interface.
     * Finds the "Document Manager" label or falls back to the main content wrapper.
     */
    injectBulkButton: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'injectBulkButton');
        log('Attempting to inject UI...');

        let container = Core.getElement(Elements.DOC_MANAGER_LABEL);

        // Fallback to Main Content Wrapper if the label isn't found
        if (!container) {
            container = Core.getElement(Elements.MAIN_CONTENT_WRAPPER);
        }

        if (!container) return log('ERROR: Container not found.');

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        const btn = document.createElement('button');
        btn.innerText = "↓ All";
        btn.title = "Download all documents (format set in Tampermonkey menu)";
        btn.style.cssText = `
            position: absolute; right: 50px; top: 50%; transform: translateY(-50%); z-index: 99;
            appearance: none; background: transparent; border: 0; outline: none; box-shadow: none;
            font-family: inherit; font-size: 12px; font-weight: 600; color: inherit; cursor: pointer;
            padding: 6px 10px; border-radius: 4px; opacity: 0.6; transition: opacity 0.2s, background-color 0.2s;
        `;

        btn.onmouseover = () => { btn.style.opacity = "1"; btn.style.backgroundColor = "rgba(128, 128, 128, 0.15)"; };
        btn.onmouseout = () => { btn.style.opacity = "0.6"; btn.style.backgroundColor = "transparent"; };
        btn.onclick = this.runBulkExport.bind(this);

        container.appendChild(btn);
        log('Bulk Button injected.');
    },

    /**
     * Injects the floating "Refresh All" button into the interface.
     * Positioned next to the "Download All" button.
     */
    injectRefreshAllButton: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'injectRefreshAllButton');
        log('Attempting to inject Refresh All button...');

        let container = Core.getElement(Elements.DOC_MANAGER_LABEL);

        // Fallback to Main Content Wrapper if the label isn't found
        if (!container) {
            container = Core.getElement(Elements.MAIN_CONTENT_WRAPPER);
        }

        if (!container) return log('ERROR: Container not found.');

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        const btn = document.createElement('button');
        btn.innerText = "↻ All";
        btn.title = "Refresh all documents (re-save to trigger FFN processing)";
        btn.style.cssText = `
            position: absolute; right: 0px; top: 50%; transform: translateY(-50%); z-index: 99;
            appearance: none; background: transparent; border: 0; outline: none; box-shadow: none;
            font-family: inherit; font-size: 12px; font-weight: 600; color: inherit; cursor: pointer;
            padding: 6px 10px; border-radius: 4px; opacity: 0.6; transition: opacity 0.2s, background-color 0.2s;
        `;

        btn.onmouseover = () => { btn.style.opacity = "1"; btn.style.backgroundColor = "rgba(128, 128, 128, 0.15)"; };
        btn.onmouseout = () => { btn.style.opacity = "0.6"; btn.style.backgroundColor = "transparent"; };
        btn.onclick = this.runBulkRefresh.bind(this);

        container.appendChild(btn);
        log('Refresh All Button injected.');
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

            const title = (row as HTMLTableRowElement).cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

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

        const content = format === DocDownloadFormat.HTML
            ? await DocFetchService.fetchPrivateDocAsHtml(docId, title)
            : await DocFetchService.fetchAndConvertPrivateDoc(docId, title);

        if (content) {
            const mimeType = format === DocDownloadFormat.HTML
                ? "text/html;charset=utf-8"
                : "text/markdown;charset=utf-8";
            saveAs(new Blob([content], { type: mimeType }), `${title}.${format}`);
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
        log(`Bulk export format: ${format}`);
        const zip = new JSZip();

        await _runBulkOperation(e, {
            verb: 'Export',
            processItem: async (item) => {
                const content = format === DocDownloadFormat.HTML
                    ? await DocFetchService.fetchPrivateDocAsHtml(item.docId, item.title)
                    : await DocFetchService.fetchAndConvertPrivateDoc(item.docId, item.title);
                if (content) {
                    zip.file(`${item.title}.${format}`, content, { date: new Date() });
                    return true;
                }
                return false;
            },
            onPermanentFailure: (item) => {
                zip.file(`ERROR_${item.title}.txt`, `Failed to retrieve content for DocID ${item.docId} after multiple attempts.`);
            },
            onFinalize: async ({ successCount, retriedItems }) => {
                const btn = e.currentTarget as HTMLButtonElement;
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
                const btn = e.currentTarget as HTMLButtonElement;
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
    }
};
