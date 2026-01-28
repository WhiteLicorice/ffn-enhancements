// ==UserScript==
// @name         FFN Enhancements
// @namespace    http://tampermonkey.net/
// @version      5.6
// @description  A suite of modern enhancements to FFN's old-school interface. Inspired by ao3-enhancements.
// @author       WhiteLicorice
// @match        https://www.fanfiction.net/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @require      https://unpkg.com/turndown/dist/turndown.js
// @require      https://unpkg.com/file-saver@2.0.4/dist/FileSaver.min.js
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    let page_name = "init"; // used for logging purposes

    // ==========================================
    // GLOBAL CORE (Shared Utilities & Logic)
    // ==========================================

    const Core = {
        turndownService: new TurndownService(),

        log: function (funcName, msg, data) {
            const prefix = `(ffn-enhancements) ${page_name} ${funcName}:`;
            if (data !== undefined) console.log(`${prefix} ${msg}`, data);
            else console.log(`${prefix} ${msg}`);
        },

        /**
         * Extracts text from a DOM object and converts to Markdown.
         * Isolated logic allows this to be reused in other contexts (like the doc editor).
         */
        parseContentFromDOM: function (doc, title) {
            const func = 'Core.parseContent';
            const contentElement = doc.querySelector("textarea[name='bio']")
                || doc.querySelector("#story_text")
                || doc.querySelector("#content");

            if (!contentElement) {
                this.log(func, `Selectors failed for "${title}"`);
                return null;
            }
            return this.turndownService.turndown(contentElement.value);
        },

        /**
         * Fetches a specific DocID and returns the Markdown content.
         */
        fetchAndConvertDoc: async function (docId, title) {
            const func = 'Core.fetchAndConvert';
            try {
                const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
                if (!response.ok) {
                    this.log(func, `Network Error for ${docId}: ${response.status}`);
                    return null;
                }

                const text = await response.text();
                const doc = new DOMParser().parseFromString(text, 'text/html');
                const markdown = this.parseContentFromDOM(doc, title);

                if (markdown) {
                    this.log(func, `Content extracted for "${title}". Length: ${markdown.length}`);
                    return markdown;
                }
            } catch (err) {
                this.log(func, `Error processing ${title}`, err);
            }
            return null;
        }
    };

    // ==========================================
    // MODULE: DOCUMENT MANAGER
    //    (Only runs on /docs/docs.php)
    // ==========================================

    const DocManager = {
        init: function () {
            if (document.querySelector('#gui_table1')) {
                this.injectUI();
            } else {
                Core.log('DocManager', 'Table not found. Waiting...');
                setTimeout(() => {
                    if (document.querySelector('#gui_table1')) this.injectUI();
                }, 1500);
            }
        },

        injectUI: function () {
            // 1. Inject the Bulk Export Button (Floating)
            this.injectBulkButton();
            // 2. Inject the "Export" column into the table
            this.injectTableColumn();
        },

        injectBulkButton: function () {
            Core.log('injectBulkButton', 'Attempting to inject UI...');
            const xpath = "//*[text()='Document Manager']";
            const textNode = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            const container = textNode ? textNode.parentNode : document.querySelector('#content_wrapper_inner');

            if (!container) return Core.log('injectBulkButton', 'ERROR: Container not found.');

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
            btn.onclick = this.runBulkExport.bind(this); // Bind 'this' to DocManager

            container.appendChild(btn);
            Core.log('injectBulkButton', 'Bulk Button injected.');
        },

        injectTableColumn: function () {
            const func = 'injectTableColumn';
            const table = document.querySelector('#gui_table1');
            if (!table) return Core.log(func, 'Table not found.');

            // 1. Add Header
            // Finding the header row can be tricky on old tables. Try to find the 'Remove' header logic or just append.
            const headerRow = table.querySelector('thead tr') || table.querySelector('tbody tr');


            if (headerRow) {
                const th = document.createElement('th');
                th.className = 'thead'; // FFN standard header class
                th.innerText = 'Export';
                th.align = 'center';
                th.width = '5%'; // Constraint width to prevent deadspace expansion
                headerRow.appendChild(th);
            }

            // 2. Add Row Cells
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach((row, index) => {
                // Skip rows that look like headers or dividers
                if (row.querySelector('th') || row.className.includes('thead')) return;

                // Only add cells to rows that actually contain a document link
                const editLink = row.querySelector('a[href*="docid="]');
                if (!editLink) return;

                const td = document.createElement('td');
                td.align = 'center';
                td.vAlign = 'top';
                td.width = '5%'; // Match header width

                const docId = editLink.href.match(/docid=(\d+)/)[1];
                const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

                const link = document.createElement('a');
                link.innerText = "Export";
                link.href = "#";
                link.style.textDecoration = "none";
                link.style.whiteSpace = "nowrap";
                link.onclick = (e) => {
                    e.preventDefault();
                    this.runSingleExport(e.target, docId, title);
                };
                td.appendChild(link);

                row.appendChild(td);
            });
            Core.log(func, 'Column injected.');
        },

        runSingleExport: async function (btnElement, docId, title) {
            const func = 'runSingleExport';
            const originalText = btnElement.innerText;

            btnElement.innerText = "...";
            btnElement.style.color = "gray";
            btnElement.style.cursor = "wait";

            Core.log(func, `Starting export for ${title} (${docId})`);

            const markdown = await Core.fetchAndConvertDoc(docId, title);

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
        },

        runBulkExport: async function (e) {
            const func = 'runBulkExport';
            Core.log(func, 'Export initiated.');
            const btn = e.target;
            const table = document.querySelector('#gui_table1');

            if (!table) return alert("Error: Table not found.");

            // --- ASSERTION BLOCK ---
            const JSZipLib = window.JSZip || JSZip;
            if (typeof JSZipLib === 'undefined' || typeof TurndownService === 'undefined' || typeof saveAs === 'undefined') {
                return alert("Error: Libraries failed to load.");
            }
            Core.log(func, 'Libraries loaded.');

            const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelector('a[href*="docid="]'));
            if (rows.length === 0) return alert("No documents to export.");

            const originalText = btn.innerText;
            btn.disabled = true;
            btn.style.cursor = "wait";
            btn.style.opacity = "1";

            const zip = new JSZipLib();
            let successCount = 0;

            // DEBUG LIMITER
            //let breakpoint = 0; const DEBUG_LIMIT = 5;

            for (let i = 0; i < rows.length; i++) {
                //breakpoint++; if (breakpoint > DEBUG_LIMIT) break;

                const row = rows[i];
                const editLink = row.querySelector('a[href*="docid="]');
                if (!editLink) continue;

                const docId = editLink.href.match(/docid=(\d+)/)[1];
                const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

                btn.innerText = `${i + 1}/${rows.length}`;

                // Rate limit
                await new Promise(r => setTimeout(r, 200));

                // Use the shared helper function
                const markdown = await Core.fetchAndConvertDoc(docId, title);

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
                    // Generate timestamp for filename: ffn_YYYY-MM-DD-HH-mm-ss.zip
                    const now = new Date();
                    const timestamp = now.toISOString().replace(/[:T.]/g, '-').slice(0, 19);
                    saveAs(blob, `ffn_${timestamp}.zip`);

                    Core.log(func, 'Download triggered.');
                    btn.innerText = "Done";
                } catch (err) {
                    Core.log(func, 'ZIP Error', err);
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
    };

    // ==========================================
    // MODULE: DOCUMENT EDITOR
    //    (Runs on /docs/edit.php)
    // ==========================================

    const DocEditor = {
        init: function () {
            Core.log('DocEditor', 'Polling for TinyMCE...');
            // Wait for TinyMCE to render the toolbar
            const checkInt = setInterval(() => {
                const toolbar = document.querySelector('#mceu_15-body'); // TODO: May be fragile. Point of update.
                if (toolbar) {
                    clearInterval(checkInt);
                    Core.log('DocEditor', 'TinyMCE toolbar found.');
                    this.injectToolbarButton(toolbar);
                }
            }, 500);

            // Timeout after 10s to stop polling
            setTimeout(() => {
                if (checkInt) clearInterval(checkInt);
            }, 5000);
        },

        injectToolbarButton: function (toolbar) {
            // Mimic TinyMCE 4 Button Structure
            // <div class="mce-widget mce-btn"> ... </div>
            const container = document.createElement('div');
            container.className = 'mce-widget mce-btn';

            container.style.float = 'right';

            container.setAttribute('aria-label', 'Download Markdown');
            container.setAttribute('role', 'button');
            container.setAttribute('tabindex', '-1');

            const button = document.createElement('button');
            button.setAttribute('type', 'button');

            // Added transparent background/border to blend in with TinyMCE
            button.style.cssText = 'padding: 4px 6px; font-size: 14px; display: flex; align-items: center; justify-content: center; background: transparent; border: 0; outline: none; box-shadow: none;';

            // Use a simple text char for the icon.
            button.innerHTML = '↓';

            button.title = "Download as Markdown";

            button.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation(); // Stop TinyMCE from stealing focus
                this.exportCurrentDoc(button);
            };

            container.appendChild(button);

            // Append to the end of the first toolbar group
            toolbar.appendChild(container);
            Core.log('DocEditor', 'Toolbar button injected.');
        },

        // --- HEADER PARSING HELPERS ---

        /**
         * Robustly extracts Title and Wordcount from the "Edit Document:..." text header.
         * Looks for: <div class='tcat'><b>...Edit Document: [Title] - [Wordcount] word(s)</b></div>
         */
        parseDocumentHeader: function () {
            const func = 'DocEditor.parseHeader';
            const headerEl = document.querySelector("div.tcat b");

            if (!headerEl) {
                Core.log(func, "Header element not found.");
                return null;
            }

            // The header contains a <select> and a text node. We iterate to find the text node.
            let textContent = null;
            for (const node of headerEl.childNodes) {
                // Check if it's a text node and contains the key phrase
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().startsWith("Edit Document:")) {
                    textContent = node.textContent.trim();
                    break;
                }
            }

            if (!textContent) {
                Core.log(func, "Header text node not found.");
                return null;
            }

            // Regex: Edit Document: <Title> - <Wordcount> word(s)
            const match = textContent.match(/Edit Document:\s*(.+?)\s*-\s*([\d,]+)\s*word\(s\)/);

            if (match) {
                return {
                    title: match[1].trim(),
                    wordCount: match[2].trim()
                };
            }

            Core.log(func, "Regex failed to match header text:", textContent);
            return null;
        },

        getTitle: function () {
            const headerData = this.parseDocumentHeader();
            let title = headerData ? headerData.title : null;

            if (!title) {
                Core.log('DocEditor.getTitle', 'Falling back to input field for title.');
                const titleInput = document.querySelector("input[name='title']");
                if (titleInput) title = titleInput.value.trim();
            }

            return title ? title.replace(/[/\\?%*:|"<>]/g, '-') : 'Untitled_Draft';
        },

        getWordCount: function () {
            const headerData = this.parseDocumentHeader();
            return headerData ? headerData.wordCount : null;
        },

        // -----------------------------

        exportCurrentDoc: function (btn) {
            const func = 'DocEditor.export';
            Core.log(func, 'Export initiated from Toolbar.');

            const title = this.getTitle();
            const wordCount = this.getWordCount();
            Core.log(func, `Detected Title: "${title}"`);
            if (wordCount) Core.log(func, `Detected Wordcount: ${wordCount}`);

            try {
                // Use the Core parser on the CURRENT document object
                // This works because in edit.php, the 'tinymce' global object exists
                Core.log(func, 'Attempting to parse TinyMCE content...');
                const markdown = Core.parseContentFromDOM(document, title);

                if (markdown) {
                    Core.log(func, `Parse success. Length: ${markdown.length} chars. Saving...`);
                    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
                    saveAs(blob, `${title}.md`);
                    Core.log(func, 'Save complete.');
                } else {
                    Core.log(func, 'Parse failed. Content was null or empty.');
                }
            } catch (e) {
                Core.log(func, 'CRITICAL ERROR during export', e);
            }
        }
    };

    // ==========================================
    // MAIN ROUTER
    // ==========================================

    const path = window.location.pathname;
    Core.log("router", `Here at https://www.fanfiction.net${path}`, path)

    // NOTE: The path includes the "/" and omits "https://www.fanfiction.net".
    // If in doubt, check your browser.
    if (path === "/docs/docs.php") {
        page_name = "doc-manager";
        DocManager.init();
    } else if (path.includes("/docs/edit.php")) {
        page_name = "doc-editor";
        DocEditor.init()
    }

})();