// ==UserScript==
// @name         FFN Document Exporter (Markdown)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Export all Fanfiction.net docs to a ZIP of Markdown files
// @author       You
// @match        https://www.fanfiction.net/docs/docs.php
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://unpkg.com/turndown/dist/turndown.js
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // 1. Setup the UI
    const exportBtn = document.createElement('button');
    exportBtn.innerText = "📥 Export All to Markdown";
    exportBtn.style = "position:fixed; top:20px; right:20px; z-index:9999; padding:12px 20px; background:#2c3e50; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);";
    document.body.appendChild(exportBtn);

    // 2. The Scraper Logic
    async function fetchDocContent(docId) {
        const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');

        // FFN uses a hidden textarea with id 'content' to store the document body
        const content = doc.querySelector('#content')?.value || "";
        return content;
    }

    // 3. The Main Execution
    exportBtn.onclick = async () => {
        const rows = document.querySelectorAll('#gui_table1 tr[id^="gui_table1_row_"]');
        if (rows.length === 0) return alert("No documents found!");

        const zip = new JSZip();
        const turndownService = new TurndownService();

        exportBtn.disabled = true;
        exportBtn.style.background = "#7f8c8d";

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const docId = row.id.replace('gui_table1_row_', '');
            const title = row.cells[0].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

            // Update button status
            exportBtn.innerText = `⏳ Processing ${i + 1}/${rows.length}...`;

            try {
                const html = await fetchDocContent(docId);
                const markdown = turndownService.turndown(html);
                zip.file(`${title}.md`, markdown);
            } catch (err) {
                console.error(`Error fetching ${title}:`, err);
            }

            // Anti-spam delay
            await new Promise(r => setTimeout(r, 400));
        }

        // Generate and Download
        exportBtn.innerText = "📦 Zipping...";
        const blob = await zip.generateAsync({ type: "blob" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "FFN_Backup.zip";
        a.click();

        exportBtn.innerText = "✅ Export Finished!";
        exportBtn.disabled = false;
        exportBtn.style.background = "#2c3e50";
    };
})();