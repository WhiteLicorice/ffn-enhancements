// ==UserScript==
// @name         FFN Exporter
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Export FFN docs to Markdown
// @author       WhiteLicorice
// @match        https://www.fanfiction.net/docs/docs.php*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @require      https://unpkg.com/turndown/dist/turndown.js
// @require      https://unpkg.com/file-saver@2.0.4/dist/FileSaver.min.js
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // --- LOGGING HELPER ---
    function log(funcName, msg, data) {
        const prefix = `(ffn-exporter) ${funcName}:`;
        if (data !== undefined) console.log(`${prefix} ${msg}`, data);
        else console.log(`${prefix} ${msg}`);
    }

    function injectButton() {
        log('injectButton', 'Attempting to inject UI...');
        const xpath = "//*[text()='Document Manager']";
        const textNode = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        const container = textNode ? textNode.parentNode : document.querySelector('#content_wrapper_inner');

        if (!container) {
            log('injectButton', 'ERROR: Container not found.');
            return;
        }

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        container.appendChild(createButton());
        log('injectButton', 'Button successfully injected.');
    }

    function createButton() {
        const btn = document.createElement('button');
        btn.innerText = "📥 Export All";
        btn.title = "Download all stories as Markdown";

        btn.style.cssText = `
            position: absolute;
            right: 0px;
            top: 50%;
            transform: translateY(-50%);
            z-index: 99;
            appearance: none;
            background: transparent;
            border: 0;
            outline: none;
            box-shadow: none;
            font-family: inherit;
            font-size: 12px;
            font-weight: 600;
            color: inherit;
            cursor: pointer;
            padding: 6px 10px;
            border-radius: 4px;
            opacity: 0.6;
            transition: opacity 0.2s, background-color 0.2s;
        `;

        btn.onmouseover = () => {
            btn.style.opacity = "1";
            btn.style.backgroundColor = "rgba(128, 128, 128, 0.15)";
        };
        btn.onmouseout = () => {
            btn.style.opacity = "0.6";
            btn.style.backgroundColor = "transparent";
        };

        btn.onclick = runExport;
        return btn;
    }

    async function runExport(e) {
        const func = 'runExport';
        log(func, 'Export initiated.');
        const btn = e.target;
        const table = document.querySelector('#gui_table1');

        if (!table) return alert("Error: Table not found.");

        // --- ASSERTION BLOCK ---
        // Version 3.1.5 is more stable for legacy sites like FFN?
        const JSZipLib = window.JSZip || JSZip;
        if (typeof JSZipLib === 'undefined' || typeof TurndownService === 'undefined' || typeof saveAs === 'undefined') {
            log(func, 'ASSERT FAIL: Critical libraries (JSZip/Turndown/FileSaver) are missing.');
            return alert("Error: Libraries failed to load. Check internet connection.");
        }

        log(func, 'Libraries (JSZip, Turndown, FileSaver) loaded successfully.');
        // -----------------------

        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelectorAll('td').length > 0);
        if (rows.length === 0) {
            log(func, 'No rows found in table.');
            return alert("No documents to export.");
        }

        log(func, `Found ${rows.length} rows to process.`);

        // UI State: Working
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.style.cursor = "wait";
        btn.style.opacity = "1";

        const zip = new JSZipLib();
        const turndownService = new TurndownService();
        let successCount = 0;

        // DEBUG LIMITER
        //let breakpoint = 0;
        //const DEBUG_LIMIT = 10;

        for (let i = 0; i < rows.length; i++) {
            // breakpoint++;
            // if (breakpoint > DEBUG_LIMIT) {
            //     log(func, `Debug limit reached (${DEBUG_LIMIT}). Breaking loop.`);
            //     break;
            // }

            const row = rows[i];
            const editLink = row.querySelector('a[href*="docid="]');
            if (!editLink) {
                log(func, `Skipping row ${i}: No edit link found.`);
                continue;
            }

            const docId = editLink.href.match(/docid=(\d+)/)[1];
            const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

            btn.innerText = `${i + 1}/${rows.length}`;
            log(func, `Fetching DocID: ${docId} ("${title}")...`);

            try {
                // Rate limit protection
                await new Promise(r => setTimeout(r, 200));

                const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
                if (!response.ok) {
                    log(func, `Network Error for ${docId}: ${response.status}`);
                    continue;
                }

                // The "Raw HTML" you see in DevTools (#document) is an IFRAME created by the TinyMCE editor.
                // However, fetch() retrieves the *Source Code* of the page, not the rendered DOM.
                // In the source code, the story text always resides in a <textarea> so the editor can read it on load.
                // We don't need to parse the iframe... we just need to grab the value of that textarea.
                const text = await response.text();
                const doc = new DOMParser().parseFromString(text, 'text/html');

                const contentElement = doc.querySelector("textarea[name='bio']")
                    || doc.querySelector("#story_text")
                    || doc.querySelector("#content");

                const content = contentElement ? contentElement.value : null;

                if (content) {
                    log(func, `Content found for "${title}". Length: ${content.length}`);
                    // log(func, `${content}`) // Uncomment for verbose content logging
                    const markdown = turndownService.turndown(content);

                    // Added explicit date to ensure metadata doesn't cause issues in sandboxed zip creation
                    zip.file(`${title}.md`, markdown, { date: new Date() });
                    successCount++;
                } else {
                    log(func, `WARNING: No content found for "${title}" (ID: ${docId}). Selectors failed.`);
                }
            } catch (err) { log(func, `Error processing ${title}`, err); }
        }

        log(func, `Loop finished. Success Count: ${successCount}`);

        if (successCount > 0) {
            // Force the browser to render "Zipping..." before starting heavy work
            btn.innerText = "Zipping...";
            // Allow DOM to update
            await new Promise(r => setTimeout(r, 250));
            log(func, 'Starting ZIP generation...');

            try {
                // We generate as uint8array and manually convert to Blob.
                // This bypasses potential JSZip internal issues with Blob polyfills on legacy pages.
                const content = await zip.generateAsync({
                    type: "uint8array",
                    compression: "STORE",
                    streamFiles: false
                });

                log(func, `Binary data generated. Size: ${content.length} bytes.`);

                const blob = new Blob([content], { type: "application/zip" });
                log(func, `Blob wrapped successfully. Size: ${blob.size}`);

                log(func, 'Handing off to FileSaver...');
                saveAs(blob, "FFN_Backup.zip");

                log(func, 'FileSaver save triggered.');
                btn.innerText = "Done";

            } catch (zipErr) {
                log(func, 'CRITICAL ZIP/DOWNLOAD ERROR:', zipErr);
                btn.innerText = "Err";
                alert("Error generating ZIP. See console.");
            }
        } else {
            log(func, 'Zero documents extracted.');
            btn.innerText = "Error";
        }

        // Reset UI
        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.cursor = "pointer";
            btn.style.opacity = "0.6";
        }, 3000);
    }

    // Initialize
    if (document.querySelector('#gui_table1')) {
        injectButton();
    } else {
        log('Global', 'Table not found. Waiting...');
        setTimeout(() => {
            if (document.querySelector('#gui_table1')) injectButton();
        }, 1500);
    }
})();