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
            position: absolute; right: 0px; top: 50%; transform: translateY(-50%); z-index: 99;
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
     * Injects new "Export" and "Refresh" columns into the document management table.
     * Adds an "Export" button and a "Refresh" button to each row.
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
            // 1. Export Header
            const thExport = document.createElement('th');
            thExport.className = 'thead';
            thExport.innerText = 'Export';
            thExport.align = 'center';
            thExport.width = '5%';
            headerRow.appendChild(thExport);

            // 2. Refresh Header
            const thRefresh = document.createElement('th');
            thRefresh.className = 'thead';
            thRefresh.innerText = 'Refresh';
            thRefresh.align = 'center';
            thRefresh.width = '5%';
            headerRow.appendChild(thRefresh);
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

            // --- 1. Export Column ---
            const tdExport = document.createElement('td');
            tdExport.align = 'center';
            tdExport.vAlign = 'top';
            tdExport.width = '5%';

            const exportLink = document.createElement('a');
            exportLink.innerText = "Export";
            exportLink.href = "#";
            exportLink.style.textDecoration = "none";
            exportLink.style.whiteSpace = "nowrap";
            exportLink.onclick = (e) => {
                e.preventDefault();
                this.runSingleExport(e.target as HTMLElement, docId, title);
            };
            tdExport.appendChild(exportLink);
            row.appendChild(tdExport);

            // --- 2. Refresh Column ---
            const tdRefresh = document.createElement('td');
            tdRefresh.align = 'center';
            tdRefresh.vAlign = 'top';
            tdRefresh.width = '5%';

            const refreshLink = document.createElement('a');
            refreshLink.innerText = "Refresh";
            refreshLink.href = "#";
            refreshLink.style.textDecoration = "none";
            refreshLink.style.whiteSpace = "nowrap";
            refreshLink.onclick = (e) => {
                e.preventDefault();
                this.runSingleRefresh(e.target as HTMLElement, docId, title);
            };
            tdRefresh.appendChild(refreshLink);
            row.appendChild(tdRefresh);
        });

        log('Columns injected.');
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
            setTimeout(() => {
                btnElement.innerText = originalText;
                btnElement.style.color = "";
                btnElement.style.cursor = "pointer";
            }, 2000);
        }
    },

    /**
     * Handles the refreshing of a document's timestamp (Keep Alive) by simulating a Save action.
     * Uses URLSearchParams to ensure the POST body is encoded correctly for FFN's PHP backend.
     */
    runSingleRefresh: async function (btnElement: HTMLElement, docId: string, title: string) {
        const log = Core.getLogger('doc-manager', 'runSingleRefresh');
        const originalText = btnElement.innerText;

        btnElement.innerText = "...";
        btnElement.style.color = "gray";
        btnElement.style.cursor = "wait";

        log(`Refreshing doc: ${title} (${docId})`);

        try {
            // 1. Fetch the edit page
            const editUrl = `https://www.fanfiction.net/docs/edit.php?docid=${docId}`;
            const response = await fetch(editUrl);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

            // 2. Get the form.
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const form = Core.getElement(Elements.DOC_FORM, doc) as HTMLFormElement;

            if (!form) {
                log("CRITICAL ERROR: Form not found.");
                btnElement.innerText = "Empty";
                return;
            }

            // 3. Prepare the POST body using URLSearchParams
            // This forces 'application/x-www-form-urlencoded' which FFN requires.
            const params = new URLSearchParams();
            const formData = new FormData(form);

            // Transfer all existing form fields (hidden IDs, session tokens if any)
            formData.forEach((value, key) => {
                params.append(key, value as string);
            });

            // Specific Validation for Content
            const textArea = form.querySelector('textarea[name="bio"]');
            const content = textArea ? textArea.textContent : "";

            if (!content || content.trim().length === 0) {
                log("CRITICAL ERROR: Content is empty. Aborting to prevent accidental wipe.");
                btnElement.innerText = "Empty";
                return;
            }

            // Ensure content is in the params (DOMParser doesn't always put textarea text into FormData)
            params.set('content', content);
            // Crucial: The backend looks for the 'submit' key to trigger the save logic
            params.set('submit', 'Save Changes');

            // 4. Submit back to the edit page
            log(`Submitting update for ${docId}...`);
            const postResponse = await fetch(editUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params
            });

            if (postResponse.ok) {
                btnElement.innerText = "Refreshed";
                log(`Successfully refreshed ${title}.`);
            } else {
                throw new Error(`POST failed: ${postResponse.status}`);
            }

        } catch (error) {
            btnElement.innerText = "Err";
            log(`Failed to refresh ${title}.`, error);
        }

        setTimeout(() => {
            btnElement.innerText = originalText;
            btnElement.style.color = "";
            btnElement.style.cursor = "pointer";
        }, 2000);
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
    }
};