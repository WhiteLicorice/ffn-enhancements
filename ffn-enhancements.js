// ==UserScript==
// @name         FFN Exporter
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Export FFN docs to Markdown
// @author       WhiteLicorice
// @match        https://www.fanfiction.net/docs/docs.php*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @require      https://unpkg.com/turndown/dist/turndown.js
// @require      https://unpkg.com/file-saver@2.0.4/dist/FileSaver.min.js
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // --- SHARED UTILITIES ---
    const turndownService = new TurndownService();

    // --- LOGGING HELPER ---
    function log(funcName, msg, data) {
        const prefix = `(ffn-exporter) ${funcName}:`;
        if (data !== undefined) console.log(`${prefix} ${msg}`, data);
        else console.log(`${prefix} ${msg}`);
    }

    // --- CORE LOGIC: PARSING ---

    /**
     * Extracts text from a DOM object and converts to Markdown.
     * Isolated logic allows this to be reused in other contexts (like the doc editor).
     */
    function parseContentFromDOM(doc, title) {
        const func = 'parseContent';
        const contentElement = doc.querySelector("textarea[name='bio']")
            || doc.querySelector("#story_text")
            || doc.querySelector("#content");

        if (!contentElement) {
            log(func, `Selectors failed for "${title}"`);
            return null;
        }
        return turndownService.turndown(contentElement.value);
    }

    /**
     * Fetches a specific DocID and returns the Markdown content.
     * Used by both Bulk and Single exporters.
     */
    async function fetchAndConvertDoc(docId, title) {
        const func = 'fetchAndConvert';
        try {
            const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
            if (!response.ok) {
                log(func, `Network Error for ${docId}: ${response.status}`);
                return null;
            }

            const text = await response.text();
            const doc = new DOMParser().parseFromString(text, 'text/html');
            const markdown = parseContentFromDOM(doc, title);

            if (markdown) {
                log(func, `Content extracted for "${title}". Length: ${markdown.length}`);
                return markdown;
            }
        } catch (err) {
            log(func, `Error processing ${title}`, err);
        }
        return null;
    }

    // --- UI: INJECTION ---

    function initUI() {
        // 1. Inject the Bulk Export Button (Floating)
        injectBulkButton();

        // 2. Inject the "Export" column into the table
        injectTableColumn();
    }

    function injectBulkButton() {
        log('injectBulkButton', 'Attempting to inject UI...');
        const xpath = "//*[text()='Document Manager']";
        const textNode = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        const container = textNode ? textNode.parentNode : document.querySelector('#content_wrapper_inner');

        if (!container) return log('injectBulkButton', 'ERROR: Container not found.');

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        const btn = document.createElement('button');
        btn.innerText = "📥 Export All";
        btn.title = "Download all stories as Markdown";
        btn.style.cssText = `
            position: absolute; right: 0px; top: 50%; transform: translateY(-50%); z-index: 99;
            appearance: none; background: transparent; border: 0; outline: none; box-shadow: none;
            font-family: inherit; font-size: 12px; font-weight: 600; color: inherit; cursor: pointer;
            padding: 6px 10px; border-radius: 4px; opacity: 0.6; transition: opacity 0.2s, background-color 0.2s;
        `;

        btn.onmouseover = () => { btn.style.opacity = "1"; btn.style.backgroundColor = "rgba(128, 128, 128, 0.15)"; };
        btn.onmouseout = () => { btn.style.opacity = "0.6"; btn.style.backgroundColor = "transparent"; };
        btn.onclick = runBulkExport;

        container.appendChild(btn);
        log('injectBulkButton', 'Bulk Button injected.');
    }

    function injectTableColumn() {
        const func = 'injectTableColumn';
        const table = document.querySelector('#gui_table1');
        if (!table) return log(func, 'Table not found.');

        // 1. Add Header
        // Finding the header row can be tricky on old tables. Try to find the 'Remove' header logic or just append.
        const headerRow = table.querySelector('thead tr') || table.querySelector('tbody tr');
        if (headerRow) {
            const th = document.createElement('th');
            th.className = 'thead'; // Standard FFN table header class
            th.innerText = 'Export';
            th.align = 'left'; // Ugh, FFN is using legacy attribs
            headerRow.appendChild(th);
        }

        // 2. Add Row Cells
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach((row, index) => {
            // Skip header row if it's inside tbody (common in old HTML)
            if (row.querySelector('th') || row.cells.length < 2) return;

            const td = document.createElement('td');
            td.className = 'celltype2'; // Standard FFN cell class
            td.align = 'center';
            td.vAlign = 'top';

            // Find DocID to verify this is a valid row
            const editLink = row.querySelector('a[href*="docid="]');
            if (editLink) {
                const docId = editLink.href.match(/docid=(\d+)/)[1];
                const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

                const link = document.createElement('a');
                link.innerText = "Export";
                link.href = "#";
                link.style.textDecoration = "none";
                link.onclick = (e) => {
                    e.preventDefault();
                    runSingleExport(e.target, docId, title);
                };
                td.appendChild(link);
            }

            row.appendChild(td);
        });
        log(func, 'Column injected.');
    }

    // --- ACTIONS: EXPORT ---

    /**
     * Handles the "Export" click on a single table row.
     */
    async function runSingleExport(btnElement, docId, title) {
        const func = 'runSingleExport';
        const originalText = btnElement.innerText;

        btnElement.innerText = "...";
        btnElement.style.color = "gray";
        btnElement.style.cursor = "wait";

        log(func, `Starting export for ${title} (${docId})`);

        const markdown = await fetchAndConvertDoc(docId, title);

        if (markdown) {
            const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
            saveAs(blob, `${title}.md`);
            btnElement.innerText = "Done";

            // Reset link after delay
            setTimeout(() => {
                btnElement.innerText = originalText;
                btnElement.style.color = "";
                btnElement.style.cursor = "pointer";
            }, 2000);
        } else {
            btnElement.innerText = "Err";
            alert("Failed to fetch document content.");
        }
    }

    /**
     * Handles the "Export All" floating button.
     */
    async function runBulkExport(e) {
        const func = 'runBulkExport';
        log(func, 'Export initiated.');
        const btn = e.target;
        const table = document.querySelector('#gui_table1');

        if (!table) return alert("Error: Table not found.");

        // --- ASSERTION BLOCK ---
        const JSZipLib = window.JSZip || JSZip;
        if (typeof JSZipLib === 'undefined' || typeof TurndownService === 'undefined' || typeof saveAs === 'undefined') {
            return alert("Error: Libraries failed to load.");
        }
        log(func, 'Libraries loaded.');

        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelectorAll('td').length > 0 && !row.querySelector('th'));
        if (rows.length === 0) return alert("No documents to export.");

        const originalText = btn.innerText;
        btn.disabled = true;
        btn.style.cursor = "wait";
        btn.style.opacity = "1";

        const zip = new JSZipLib();
        let successCount = 0;

        // DEBUG LIMITER
        let breakpoint = 0; const DEBUG_LIMIT = 3;

        for (let i = 0; i < rows.length; i++) {
            breakpoint++; if (breakpoint > DEBUG_LIMIT) break;

            const row = rows[i];
            const editLink = row.querySelector('a[href*="docid="]');
            if (!editLink) continue;

            const docId = editLink.href.match(/docid=(\d+)/)[1];
            const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

            btn.innerText = `${i + 1}/${rows.length}`;

            // Rate limit
            await new Promise(r => setTimeout(r, 200));

            // Use the shared helper function
            const markdown = await fetchAndConvertDoc(docId, title);

            if (markdown) {
                zip.file(`${title}.md`, markdown, { date: new Date() });
                successCount++;
            }
        }

        if (successCount > 0) {
            btn.innerText = "Zipping...";
            await new Promise(r => setTimeout(r, 500));

            try {
                // Generate uint8array -> Blob manually (Most stable method)
                const content = await zip.generateAsync({
                    type: "uint8array",
                    compression: "STORE",
                    streamFiles: false
                });

                const blob = new Blob([content], { type: "application/zip" });
                saveAs(blob, "FFN_Backup.zip");

                log(func, 'Download triggered.');
                btn.innerText = "Done";
            } catch (err) {
                log(func, 'ZIP Error', err);
                btn.innerText = "Err";
            }
        } else {
            btn.innerText = "Error";
            alert("No content extracted.");
        }

        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.cursor = "pointer";
            btn.style.opacity = "0.6";
        }, 3000);
    }

    // Initialize
    if (document.querySelector('#gui_table1')) {
        initUI();
    } else {
        log('Global', 'Table not found. Waiting...');
        setTimeout(() => {
            if (document.querySelector('#gui_table1')) initUI();
        }, 1500);
    }
})();