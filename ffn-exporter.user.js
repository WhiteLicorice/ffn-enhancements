// ==UserScript==
// @name         FFN Exporter
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Export FFN docs to Markdown
// @author       WhiteLicorice
// @match        https://www.fanfiction.net/docs/docs.php*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://unpkg.com/turndown/dist/turndown.js
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // --- LOGGING HELPER ---
    function log(funcName, msg, data) {
        const prefix = `(ffn-exporter) ${funcName}:`;
        if (data !== undefined) {
            console.log(`${prefix} ${msg}`, data);
        } else {
            console.log(`${prefix} ${msg}`);
        }
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

        const exportBtn = createButton();
        container.appendChild(exportBtn);
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
        // These are loaded via the @require tags in the metadata block above.
        // Tampermonkey injects them before this script runs.
        if (typeof JSZip === 'undefined' || typeof TurndownService === 'undefined') {
            log(func, 'ASSERT FAIL: Critical libraries (JSZip/Turndown) are missing.');
            return alert("Error: Libraries failed to load. Check internet connection.");
        }

        // Explicitly log that the assertion passed
        log(func, 'ASSERT PASS: Libraries (JSZip, Turndown) loaded successfully.');
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

        const zip = new JSZip();
        const turndownService = new TurndownService();
        let successCount = 0;

        // DEBUG LIMITER
        let breakpoint = 0;
        const DEBUG_LIMIT = 10;

        for (let i = 0; i < rows.length; i++) {
            breakpoint++;
            if (breakpoint > DEBUG_LIMIT) {
                log(func, `Debug limit reached (${DEBUG_LIMIT}). Breaking loop.`);
                break;
            }

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
                // Rate Limit Protection
                await new Promise(r => setTimeout(r, 200)); // Slightly faster delay

                const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
                if (!response.ok) {
                    log(func, `Network Error for ${docId}: ${response.status}`);
                    continue;
                }

                //  The "Raw HTML" you see in DevTools (#document) is an IFRAME created by the TinyMCE editor.
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
                    log(func, `${content}`) // Uncomment for verbose content logging
                    zip.file(`${title}.md`, turndownService.turndown(content));
                    successCount++;
                } else {
                    log(func, `WARNING: No content found for "${title}" (ID: ${docId}). Selectors failed.`);
                }

            } catch (err) {
                log(func, `EXCEPTION processing ${title}`, err);
            }
        }

        log(func, `Loop finished. Success Count: ${successCount}`);

        if (successCount > 0) {
            btn.innerText = "Zipping 0%";
            log(func, 'Starting ZIP...');

            try {
                // This disables CPU-heavy compression. Markdown text is already small enough.
                const blob = await zip.generateAsync({
                    type: "blob",
                    compression: "STORE",
                    streamFiles: true,
                }, (metadata) => {
                    // Update button with real-time progress
                    btn.innerText = `Zip ${metadata.percent.toFixed(0)}%`;
                });

                log(func, `ZIP Generated. Size: ${blob.size} bytes.`);

                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = "FFN_Backup.zip";

                log(func, 'Triggering download click...');
                document.body.appendChild(a); // Append to body to ensure click works in all browsers
                a.click();
                document.body.removeChild(a); // Clean up

                btn.innerText = "Done";
                log(func, 'Download triggered successfully.');

            } catch (zipErr) {
                log(func, 'CRITICAL ZIP ERROR:', zipErr);
                alert("Error generating ZIP file. Check console.");
                btn.innerText = "Zip Error";
            }
        } else {
            log(func, 'Zero documents extracted. Aborting download.');
            btn.innerText = "Error";
            alert("No content extracted.");
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
        log('Global', 'Table #gui_table1 not found immediately. Waiting or manual check needed.');
        // Fallback check
        setTimeout(() => {
            if (document.querySelector('#gui_table1')) injectButton();
        }, 1000);
    }
})();