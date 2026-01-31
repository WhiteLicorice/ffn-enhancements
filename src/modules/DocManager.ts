// modules/DocManager.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

/**
 * Module responsible for enhancing the Document Manager page (`/docs/docs.php`).
 */
export const DocManager = {
    /**
     * Initializes the module by checking for the document table.
     * Uses polling to ensure the table is present before injecting UI.
     */
    init: function () {
        Core.onDomReady(() => {
            if (Core.getElement(Elements.DOC_TABLE)) {
                this.injectUI();
            } else {
                Core.log('doc-manager', 'DocManager', 'Table not found. Waiting...');
                setTimeout(() => {
                    if (Core.getElement(Elements.DOC_TABLE)) this.injectUI();
                }, 1500);
            }
        });
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
        Core.log('doc-manager', 'injectBulkButton', 'Attempting to inject UI...');

        let container = Core.getElement(Elements.DOC_MANAGER_LABEL);

        // Fallback to Main Content Wrapper if the label isn't found
        if (!container) {
            container = Core.getElement(Elements.MAIN_CONTENT_WRAPPER);
        }

        if (!container) return Core.log('doc-manager', 'injectBulkButton', 'ERROR: Container not found.');

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
        Core.log('doc-manager', 'injectBulkButton', 'Bulk Button injected.');
    },

    /**
     * Injects a new "Export" column into the document management table.
     * Adds an "Export" button to each row for individual downloading.
     */
    injectTableColumn: function () {
        const func = 'injectTableColumn';

        const table = Core.getElement(Elements.DOC_TABLE);
        if (!table) return Core.log('doc-manager', func, 'Table not found.');

        const headerRow = Core.getElement(Elements.DOC_TABLE_HEAD_ROW);

        if (headerRow) {
            const th = document.createElement('th');
            th.className = 'thead';
            th.innerText = 'Export';
            th.align = 'center';
            th.width = '5%';
            headerRow.appendChild(th);
        }

        const rows = Core.getElements(Elements.DOC_TABLE_BODY_ROWS);

        rows.forEach((row) => {
            if (row.querySelector('th') || row.className.includes('thead')) return;

            const editLink = row.querySelector('a[href*="docid="]') as HTMLAnchorElement;
            if (!editLink) return;

            const td = document.createElement('td');
            td.align = 'center';
            td.vAlign = 'top';
            td.width = '5%';

            const docId = editLink.href.match(/docid=(\d+)/)![1];
            const title = (row as HTMLTableRowElement).cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

            const link = document.createElement('a');
            link.innerText = "Export";
            link.href = "#";
            link.style.textDecoration = "none";
            link.style.whiteSpace = "nowrap";
            link.onclick = (e) => {
                e.preventDefault();
                this.runSingleExport(e.target as HTMLElement, docId, title);
            };
            td.appendChild(link);
            row.appendChild(td);
        });

        Core.log('doc-manager', func, 'Column injected.');
    },

    /**
     * Handles the export of a single document given a DocID.
     * @param btnElement - The button clicked (for UI feedback).
     * @param docId - The FFN Document ID.
     * @param title - The title of the document.
     */
    runSingleExport: async function (btnElement: HTMLElement, docId: string, title: string) {
        const func = 'runSingleExport';
        const originalText = btnElement.innerText;

        btnElement.innerText = "...";
        btnElement.style.color = "gray";
        btnElement.style.cursor = "wait";

        Core.log('doc-manager', func, `Starting export for ${title} (${docId})`);
        const markdown = await Core.fetchAndConvertDoc(docId, title);

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
            alert("Failed to fetch document content.");
        }
    },

    /**
     * Handles the bulk export of all visible documents into a ZIP file.
     * Iterates through all rows, fetches content, and packages it.
     * @param e - The mouse event from the bulk button.
     */
    runBulkExport: async function (e: MouseEvent) {
        const func = 'runBulkExport';
        Core.log('doc-manager', func, 'Export initiated.');
        const btn = e.target as HTMLButtonElement;

        if (!Core.getElement(Elements.DOC_TABLE)) return alert("Error: Table not found.");

        const allRows = Core.getElements(Elements.DOC_TABLE_BODY_ROWS);

        // Filter for rows that actually contain documents
        const rows = allRows.filter(row => row.querySelector('a[href*="docid="]'));

        if (rows.length === 0) return alert("No documents to export.");

        const originalText = btn.innerText;
        btn.disabled = true;
        btn.style.cursor = "wait";
        btn.style.opacity = "1";

        const zip = new JSZip();
        let successCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i] as HTMLTableRowElement;
            const editLink = row.querySelector('a[href*="docid="]') as HTMLAnchorElement;
            if (!editLink) continue;

            const docId = editLink.href.match(/docid=(\d+)/)![1];
            const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

            btn.innerText = `${i + 1}/${rows.length}`;

            // 1500ms delay to avoid 429 Rate Limits
            await new Promise(r => setTimeout(r, 1500));

            const markdown = await Core.fetchAndConvertDoc(docId, title);
            if (markdown) {
                zip.file(`${title}.md`, markdown, { date: new Date() });
                successCount++;
            }
        }

        if (successCount > 0) {
            btn.innerText = "Zipping...";

            // Generate 'blob' directly instead of 'uint8array', because TS is being strict about this
            const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
            const timestamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19);
            saveAs(blob, `ffn_${timestamp}.zip`);
            btn.innerText = "Done";
        }

        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.cursor = "pointer";
            btn.style.opacity = "0.6";
        }, 3000);
    }
};