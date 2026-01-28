// ==UserScript==
// @name         FFN Document Exporter (Markdown) v1.2
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Export all Fanfiction.net docs to a ZIP of Markdown files
// @author       You
// @match        https://www.fanfiction.net/docs/docs.php*
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
        try {
            const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');

            // FFN edit pages usually store text in a textarea named 'story_text' or id 'content'
            const content = doc.querySelector('#story_text')?.value
                || doc.querySelector('#content')?.value
                || doc.querySelector('textarea')?.value
                || "";
            return content;
        } catch (e) {
            console.error("Fetch failed", e);
            return "";
        }
    }

    // 3. The Main Execution
    exportBtn.onclick = async () => {
        // SELECTOR FIX: Rows do not have IDs, so we just grab all rows in the table body
        const table = document.querySelector('#gui_table1');
        if (!table) return alert("Table #gui_table1 not found!");

        // Get all rows, but filter out headers (rows with 'th')
        const rows = Array.from(table.querySelectorAll('tr')).filter(row => row.querySelectorAll('td').length > 0);

        if (rows.length === 0) return alert("No documents found!");

        const zip = new JSZip();
        const turndownService = new TurndownService();

        exportBtn.disabled = true;
        exportBtn.style.background = "#7f8c8d";

        let successCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            // LOGIC FIX: Extract DocID from the 'Edit' link instead of the row ID
            // The link is usually in the 2nd cell (Title) or 4th cell (Edit/View)
            const editLink = row.querySelector('a[href*="docid="]');
            if (!editLink) continue; // Skip if no link found

            const docIdMatch = editLink.href.match(/docid=(\d+)/);
            if (!docIdMatch) continue;
            const docId = docIdMatch[1];

            // LOGIC FIX: Title is in the 2nd cell (index 1), first cell is just the number
            const titleCell = row.cells[1];
            const title = titleCell ? titleCell.innerText.trim().replace(/[/\\?%*:|"<>]/g, '-') : `Doc_${docId}`;

            // Update button status
            exportBtn.innerText = `⏳ Processing ${i + 1}/${rows.length}...`;

            try {
                const html = await fetchDocContent(docId);
                if (html) {
                    const markdown = turndownService.turndown(html);
                    zip.file(`${title}.md`, markdown);
                    successCount++;
                } else {
                    console.warn(`Empty content for ${title} (ID: ${docId})`);
                }
            } catch (err) {
                console.error(`Error fetching ${title}:`, err);
            }

            // Anti-spam delay
            await new Promise(r => setTimeout(r, 500));
        }

        if (successCount === 0) {
            exportBtn.innerText = "❌ Failed to fetch content";
            alert("Could not extract content. Please check if you are logged in or if the layout changed.");
            return;
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