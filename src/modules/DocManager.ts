// modules/DocManager.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DocIframeHandler } from './DocIframeHandler';

/**
 * Module responsible for enhancing the Document Manager page (`/docs/docs.php`).
 */
export const DocManager = {
    LIFE_COL_IDX: 5,

    /**
     * Initializes the module by checking for the document table and observing for the Copy-N-Paste editor.
     */
    init: function () {
        const log = Core.getLogger('doc-manager', 'init');

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
        const log = Core.getLogger('doc-manager', 'waitForTable');
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
        const log = Core.getLogger('doc-manager', 'injectBulkButton');
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
        btn.title = "Download all documents as Markdown";
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
        const log = Core.getLogger('doc-manager', 'injectRefreshAllButton');
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
        const log = Core.getLogger('doc-manager', 'injectTableColumn');

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
                this.runSingleExport(e.target as HTMLElement, docId, title);
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
                this.runSingleRefresh(e.target as HTMLElement, docId, title);
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
        const log = Core.getLogger('doc-manager', 'updateLifeColumn');
        try {
            // Life column is the 6th column (index 5)
            // Structure: Title | Size | Updated | Life | Export | Refresh
            const lifeCell = row.cells[this.LIFE_COL_IDX];
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
     * @param btnElement - The button clicked (for UI feedback).
     * @param docId - The FFN Document ID.
     * @param title - The title of the document.
     */
    runSingleExport: async function (btnElement: HTMLElement, docId: string, title: string) {
        const log = Core.getLogger('doc-manager', 'runSingleExport');
        const originalText = btnElement.innerText;

        btnElement.innerText = "...";
        btnElement.style.color = "gray";
        btnElement.style.cursor = "wait";

        log(`Starting export for ${title} (${docId})`);
        const markdown = await Core.fetchAndConvertPrivateDoc(docId, title);

        if (markdown) {
            const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
            saveAs(blob, `${title}.md`);
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
        const log = Core.getLogger('doc-manager', 'runSingleRefresh');
        const originalText = btnElement.innerText;

        btnElement.innerText = "...";
        btnElement.style.color = "gray";
        btnElement.style.cursor = "wait";

        log(`Starting refresh for ${title} (${docId})`);
        const success = await Core.refreshPrivateDoc(docId, title);

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
     * Implements a robust Two-Pass System:
     * 1. Iterates through all rows.
     * 2. If any fail (due to rate limits), waits for a cool-down period.
     * 3. Retries the failed items with a longer delay.
     * @param e - The mouse event from the bulk button.
     */
    runBulkExport: async function (e: MouseEvent) {
        const log = Core.getLogger('doc-manager', 'runBulkExport');

        log('Export initiated.');
        const btn = e.target as HTMLButtonElement;

        if (!Core.getElement(Elements.DOC_TABLE)) {
            log("Table not found.");
            return;
        }

        const allRows = Core.getElements(Elements.DOC_TABLE_BODY_ROWS);

        // Filter for rows that actually contain documents
        const rows = allRows.filter(row => row.querySelector('a[href*="docid="]'));

        if (rows.length === 0) {
            log("No documents to export.");
            return;
        }

        const originalText = btn.innerText;
        btn.disabled = true;
        btn.style.cursor = "wait";
        btn.style.opacity = "1";

        // Store failed items for the second pass
        interface ExportItem { docId: string; title: string; }
        let failedItems: ExportItem[] = [];

        try {
            const zip = new JSZip();
            let successCount = 0;

            // ============================================================
            // PASS 1: Main Iteration
            // ============================================================
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i] as HTMLTableRowElement;
                const editLink = row.querySelector('a[href*="docid="]') as HTMLAnchorElement;
                if (!editLink) continue;

                // Safe ID Extraction
                const match = editLink.href.match(/docid=(\d+)/);
                if (!match) {
                    log('Could not extract ID from row', row);
                    continue;
                }
                const docId = match[1];

                const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

                btn.innerText = `${i + 1}/${rows.length}`;

                // Standard delay: 1000ms
                await new Promise(r => setTimeout(r, 1000));

                // Attempt Fetch
                const markdown = await Core.fetchAndConvertPrivateDoc(docId, title);

                if (markdown) {
                    zip.file(`${title}.md`, markdown, { date: new Date() });
                    successCount++;
                } else {
                    log(`Pass 1 Failed for ${title}. Queueing for retry.`);
                    failedItems.push({ docId, title });
                }
            }

            // ============================================================
            // PASS 2: Retry Logic for Skipped Items
            // ============================================================
            if (failedItems.length > 0) {
                log(`Pass 1 complete. ${failedItems.length} items failed. Starting Cool Down...`);
                btn.innerText = "Cooling...";

                // Cool Down: 5 Seconds to let FFN servers breathe
                await new Promise(r => setTimeout(r, 5000));

                for (let i = 0; i < failedItems.length; i++) {
                    const item = failedItems[i];
                    btn.innerText = `Retry ${i + 1}/${failedItems.length}`;

                    // Extended Delay: 3000ms (Very polite)
                    await new Promise(r => setTimeout(r, 3000));

                    const markdown = await Core.fetchAndConvertPrivateDoc(item.docId, item.title);

                    if (markdown) {
                        zip.file(`${item.title}.md`, markdown, { date: new Date() });
                        successCount++;
                    } else {
                        log(`Pass 2 Permanent Failure for ${item.title}`);
                        // Create a placeholder file so the user knows it failed
                        zip.file(`ERROR_${item.title}.txt`, `Failed to retrieve content for DocID ${item.docId} after multiple attempts.`);
                    }
                }
            }

            // ============================================================
            // Finalization
            // ============================================================
            if (successCount > 0 || failedItems.length > 0) {
                btn.innerText = "Zipping...";
                log(`Zipping ${successCount} documents`);

                // Generate 'blob' directly instead of 'uint8array', because TS is being strict about this
                const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
                const timestamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19);
                saveAs(blob, `ffn_${timestamp}.zip`);
                btn.innerText = "Done";
            } else {
                btn.innerText = "Empty";
            }

        } catch (error) {
            log('An error occurred during bulk export. Check console for details.', error);
            btn.innerText = "Error";
        } finally {
            // Always reset the button state, even if an error occurs
            setTimeout(() => {
                btn.innerText = originalText;
                btn.disabled = false;
                btn.style.cursor = "pointer";
                btn.style.opacity = "0.6";
            }, 3000);
        }
    },

    /**
     * Handles the bulk refresh of all visible documents.
     * Implements a robust Two-Pass System similar to bulk export:
     * 1. Iterates through all rows.
     * 2. If any fail (due to rate limits), waits for a cool-down period.
     * 3. Retries the failed items with a longer delay.
     * @param e - The mouse event from the bulk button.
     */
    runBulkRefresh: async function (e: MouseEvent) {
        const log = Core.getLogger('doc-manager', 'runBulkRefresh');

        log('Bulk refresh initiated.');
        const btn = e.target as HTMLButtonElement;

        if (!Core.getElement(Elements.DOC_TABLE)) {
            log("Table not found.");
            return;
        }

        const allRows = Core.getElements(Elements.DOC_TABLE_BODY_ROWS);

        // Filter for rows that actually contain documents
        let rows = allRows.filter(row => row.querySelector('a[href*="docid="]'));

        // Optimization: Filter out documents that already have 365 days life remaining
        // Life column is at index 5 (6th column: Title | Size | Updated | Life | Export | Refresh)
        const rowsBeforeFilter = rows.length;
        rows = rows.filter(row => {
            const lifeCell = (row as HTMLTableRowElement).cells[this.LIFE_COL_IDX];
            if (lifeCell) {
                const lifeText = lifeCell.innerText.trim();
                // Skip if already at max life (365 days)
                if (lifeText === '365 days') {
                    return false;
                }
            }
            return true;
        });

        const skippedCount = rowsBeforeFilter - rows.length;
        if (skippedCount > 0) {
            log(`Skipped ${skippedCount} document(s) that already have 365 days life remaining.`);
        }

        if (rows.length === 0) {
            log("No documents need refreshing (all already have 365 days).");
            alert('All documents already have 365 days life remaining. No refresh needed!');
            return;
        }

        // ============================================================
        // UX: Remind user not to close the page during bulk refresh
        // ============================================================
        alert(
            `Bulk Refresh will start for ${rows.length} document(s).\n\n` +
            'Please DO NOT CLOSE this tab until the refresh is complete.\n\n' +
            'The refresh runs silently in the background — you will be notified when it is done.'
        );

        const originalText = btn.innerText;
        btn.disabled = true;
        btn.style.cursor = "wait";
        btn.style.opacity = "1";

        // Store failed items for the second pass
        interface RefreshItem { docId: string; title: string; row: HTMLTableRowElement; }
        let failedItems: RefreshItem[] = [];

        try {
            let successCount = 0;

            // ============================================================
            // PASS 1: Main Iteration
            // ============================================================
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i] as HTMLTableRowElement;
                const editLink = row.querySelector('a[href*="docid="]') as HTMLAnchorElement;
                if (!editLink) continue;

                // Safe ID Extraction
                const match = editLink.href.match(/docid=(\d+)/);
                if (!match) {
                    log('Could not extract ID from row', row);
                    continue;
                }
                const docId = match[1];

                const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

                btn.innerText = `${i + 1}/${rows.length}`;

                // UX: Highlight current row being processed
                const originalBgColor = row.style.backgroundColor;
                row.style.backgroundColor = '#90EE90'; // Light green
                row.style.transition = 'background-color 0.3s ease';

                // Standard delay: 1000ms
                await new Promise(r => setTimeout(r, 1000));

                // Attempt Refresh
                const success = await Core.refreshPrivateDoc(docId, title);

                if (success) {
                    successCount++;
                    
                    // Update the Life column to show 365 days
                    this.updateLifeColumn(row, `bulk pass 1: ${title}`);
                } else {
                    log(`Pass 1 Failed for ${title}. Queueing for retry.`);
                    failedItems.push({ docId, title, row });
                }

                // UX: Remove highlight after processing
                row.style.backgroundColor = originalBgColor;
            }

            // ============================================================
            // PASS 2: Retry Logic for Failed Items
            // ============================================================
            if (failedItems.length > 0) {
                log(`Pass 1 complete. ${failedItems.length} items failed. Starting Cool Down...`);
                btn.innerText = "Cooling...";

                // Cool Down: 5 Seconds to let FFN servers breathe
                await new Promise(r => setTimeout(r, 5000));

                for (let i = 0; i < failedItems.length; i++) {
                    const item = failedItems[i];
                    btn.innerText = `Retry ${i + 1}/${failedItems.length}`;

                    // UX: Highlight current row being processed (retry)
                    const originalBgColor = item.row.style.backgroundColor;
                    item.row.style.backgroundColor = '#90EE90'; // Light green
                    item.row.style.transition = 'background-color 0.3s ease';

                    // Extended Delay: 3000ms (Very polite)
                    await new Promise(r => setTimeout(r, 3000));

                    const success = await Core.refreshPrivateDoc(item.docId, item.title);

                    if (success) {
                        successCount++;
                        
                        // Update the Life column to show 365 days
                        this.updateLifeColumn(item.row, `bulk pass 2: ${item.title}`);
                    } else {
                        log(`Pass 2 Permanent Failure for ${item.title}`);
                    }

                    // UX: Remove highlight after processing
                    item.row.style.backgroundColor = originalBgColor;
                }
            }

            // ============================================================
            // Finalization
            // ============================================================
            const totalAttempts = rows.length;

            if (successCount === totalAttempts) {
                btn.innerText = "All Done!";
                log(`Successfully refreshed all ${successCount} documents`);
                alert(`Bulk Refresh complete! All ${successCount} document(s) refreshed successfully.`);
            } else if (successCount > 0) {
                btn.innerText = `${successCount}/${totalAttempts}`;
                log(`Refreshed ${successCount} of ${totalAttempts} documents`);
                alert(`Bulk Refresh complete. ${successCount} of ${totalAttempts} document(s) refreshed successfully.\n\nSome documents could not be refreshed — check the console for details.`);
            } else {
                btn.innerText = "Failed";
                log(`Failed to refresh any documents`);
                alert(`Bulk Refresh failed. No documents could be refreshed.\n\nPlease check the console for details and try again.`);
            }

        } catch (error) {
            log('An error occurred during bulk refresh. Check console for details.', error);
            btn.innerText = "Error";
        } finally {
            // Always reset the button state, even if an error occurs
            setTimeout(() => {
                btn.innerText = originalText;
                btn.disabled = false;
                btn.style.cursor = "pointer";
                btn.style.opacity = "0.6";
            }, 3000);
        }
    }
};