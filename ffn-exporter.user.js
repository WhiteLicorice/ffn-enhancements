// ==UserScript==
// @name         FFN Document Exporter (Precision UI)
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Export FFN docs to Markdown (Targeted UI Injection)
// @author       You
// @match        https://www.fanfiction.net/docs/docs.php*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://unpkg.com/turndown/dist/turndown.js
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // --- 1. PRECISE UI INJECTION ---
    function injectButton() {
        // Strategy: Don't guess the ID. Find the element containing the text "Document Manager".
        // Ugh this shit is so ass.
        const xpath = "//*[text()='Document Manager']";
        const matchingElement = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;

        if (!matchingElement) {
            console.error("FFN Exporter: Could not find 'Document Manager' header text.");
            // Fallback: Try the table container just in case, ugh
            const fallback = document.querySelector('#content_wrapper_inner');
            if (fallback) fallback.prepend(createButton());
            return;
        }

        // We found the header element (likely a <span> or <div>).
        // To float the button on the same line, we insert it INSIDE this container.
        const exportBtn = createButton();

        // We PREPEND it (put it before the text) so 'float: right' works reliably 
        // without pushing the text down to a new line.
        matchingElement.insertBefore(exportBtn, matchingElement.firstChild);
    }

    function createButton() {
        const btn = document.createElement('button');
        btn.innerText = "📥 Export All";
        btn.title = "Download all stories as Markdown";

        // STYLE: Native Toolbar Feel
        btn.style.cssText = `
            float: right;              /* Push to the far right of the header */
            margin-top: -4px;          /* Tweak vertical alignment to center it with text */
            margin-left: 15px;         /* Breathing room from the text */
            padding: 4px 10px;
            font-family: Verdana, sans-serif;
            font-size: 11px;
            font-weight: normal;
            cursor: pointer;
            background: linear-gradient(to bottom, #ffffff 5%, #f6f6f6 100%);
            border: 1px solid #dcdcdc;
            border-radius: 3px;
            color: #333;
            text-shadow: 0px 1px 0px #ffffff;
        `;

        // Interactive states
        btn.onmouseover = () => { btn.style.background = "#e9e9e9"; btn.style.borderColor = "#adadad"; };
        btn.onmouseout = () => { btn.style.background = "linear-gradient(to bottom, #ffffff 5%, #f6f6f6 100%)"; btn.style.borderColor = "#dcdcdc"; };

        // Attach Logic
        btn.onclick = runExport;
        return btn;
    }

    // --- 2. EXPORT LOGIC ---
    async function runExport(e) {
        const btn = e.target;
        const table = document.querySelector('#gui_table1');
        if (!table) return alert("Table #gui_table1 not found!");

        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelectorAll('td').length > 0);
        if (rows.length === 0) return alert("No documents found.");
        console.log(rows);

        const zip = new JSZip();
        const turndownService = new TurndownService();
        const originalText = btn.innerText;

        btn.disabled = true;
        btn.style.opacity = "0.7";

        let successCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const editLink = row.querySelector('a[href*="docid="]');
            if (!editLink) continue;

            const docId = editLink.href.match(/docid=(\d+)/)[1];
            const titleCell = row.cells[1];
            let title = titleCell ? titleCell.innerText.trim() : `Doc_${docId}`;
            title = title.replace(/[/\\?%*:|"<>]/g, '-');

            btn.innerText = `${i + 1}/${rows.length}`;

            try {
                const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
                const text = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');

                const content = doc.querySelector('#story_text')?.value
                    || doc.querySelector('#content')?.value
                    || doc.querySelector('textarea')?.value;

                if (content) {
                    zip.file(`${title}.md`, turndownService.turndown(content));
                    successCount++;
                }
            } catch (err) {
                console.error(`Error ${title}`, err);
            }

            await new Promise(r => setTimeout(r, 300));
        }

        if (successCount > 0) {
            btn.innerText = "Zip...";
            const blob = await zip.generateAsync({ type: "blob" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "FFN_Docs_Backup.zip";
            a.click();
            btn.innerText = "Done";
        } else {
            alert("No content extracted.");
            btn.innerText = "Error";
        }

        setTimeout(() => {
            btn.innerText = originalText;
            btn.disabled = false;
            btn.style.opacity = "1";
        }, 3000);
    }

    // Run Injection
    injectButton();

})();