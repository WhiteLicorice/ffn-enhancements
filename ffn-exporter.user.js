// ==UserScript==
// @name         FFN Markdown Exporter
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Export FFN docs to Markdown
// @author       You
// @match        https://www.fanfiction.net/docs/docs.php*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://unpkg.com/turndown/dist/turndown.js
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    function injectButton() {
        // 1. Precise Target: Find the text "Document Manager"
        const xpath = "//*[text()='Document Manager']";
        const textNode = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

        // 2. Locate Container: The immediate parent of the text (usually a DIV or TD)
        const container = textNode ? textNode.parentNode : document.querySelector('#content_wrapper_inner');
        if (!container) return;

        // 3. Layout Fix: Establish a coordinate boundary for our pinned button
        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        const exportBtn = createButton();
        container.appendChild(exportBtn);
        console.log("Button injected!");
    }

    function createButton() {
        const btn = document.createElement('button');
        btn.innerText = "📥 Export All";
        btn.title = "Download all stories as Markdown";

        btn.style.cssText = `
            /* 1. Layout: Pin to vertically centered right */
            position: absolute;
            right: 0px;
            top: 50%;
            transform: translateY(-50%);
            z-index: 99;

            /* 2. Reset: Nuke all default browser borders/backgrounds */
            appearance: none;
            background: transparent;
            border: 0;
            outline: none;
            box-shadow: none;

            /* 3. Typography & Theme */
            font-family: inherit;
            font-size: 12px;
            font-weight: 600;
            color: inherit;       /* Magically works in Light & Dark mode */
            cursor: pointer;

            /* 4. Polish */
            padding: 6px 10px;
            border-radius: 4px;
            opacity: 0.6;
            transition: opacity 0.2s, background-color 0.2s;
        `;

        // Hover: Subtle feedback
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
        const btn = e.target;
        const table = document.querySelector('#gui_table1');

        // Safety check for empty table
        if (!table) return alert("Error: Table not found.");

        // These are loaded via the @require tags in the metadata block above.
        // Tampermonkey injects them before this script runs. Sanity check:
        if (typeof JSZip === 'undefined' || typeof TurndownService === 'undefined') {
            return alert("Error: Libraries failed to load. Check internet connection.");
        }

        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelectorAll('td').length > 0);
        if (rows.length === 0) return alert("No documents to export.");
        console.log(rows);

        // UI State: Working
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.style.cursor = "wait";
        btn.style.opacity = "1";

        const zip = new JSZip();
        const turndownService = new TurndownService();
        let successCount = 0;

        let breakpoint = 0;
        for (let i = 0; i < rows.length; i++) {
            breakpoint++;
            if (breakpoint > 10) {
                break;
            }
            const row = rows[i];
            const editLink = row.querySelector('a[href*="docid="]');
            if (!editLink) continue;

            const docId = editLink.href.match(/docid=(\d+)/)[1];
            // Sanitized Title
            const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

            btn.innerText = `${i + 1}/${rows.length}`;

            try {
                // Rate Limit Protection: 350ms delay
                await new Promise(r => setTimeout(r, 350));

                const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);

                //  The "Raw HTML" you see in DevTools (#document) is an IFRAME created by the TinyMCE editor.
                // However, fetch() retrieves the *Source Code* of the page, not the rendered DOM.
                // In the source code, the story text always resides in a <textarea> so the editor can read it on load.
                // We don't need to parse the iframe... we just need to grab the value of that textarea.
                const text = await response.text();
                const doc = new DOMParser().parseFromString(text, 'text/html');

                // Content extraction hierarchy
                const contentElement = doc.querySelector("textarea[name='bio']") || doc.querySelector("#story_text") || doc.querySelector("#content");

                const content = contentElement ? contentElement.value : null;
                console.log(content);
                if (content) {
                    zip.file(`${title}.md`, turndownService.turndown(content));
                    successCount++;
                }
            } catch (err) { console.error(`Failed: ${title}`, err); }
        }

        if (successCount > 0) {
            btn.innerText = "Zipping...";
            const blob = await zip.generateAsync({ type: "blob" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "FFN_Backup.zip";
            a.click();
            btn.innerText = "Done";
        } else {
            btn.innerText = "Error";
            alert("No content extracted.");
        }

        // Reset UI after 3 seconds
        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.cursor = "pointer";
            btn.style.opacity = "0.6";
        }, 3000);
    }

    // Initialize
    injectButton();
})();