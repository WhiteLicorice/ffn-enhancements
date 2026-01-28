// ==UserScript==
// @name         FFN Document Exporter (Native UI)
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Export FFN docs to Markdown (Integrated into the UI)
// @author       You
// @match        https://www.fanfiction.net/docs/docs.php*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://unpkg.com/turndown/dist/turndown.js
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    // --- 1. UI INTEGRATION ---
    // FIX: Target the wrapper DIV, not the Table. 
    // The "Document Manager" text lives inside this wrapper, just before the table.
    const contentWrapper = document.querySelector('#content_wrapper_inner');

    if (!contentWrapper) {
        // Fallback: If layout changes, find the table's parent
        const table = document.querySelector('#gui_table1');
        if (table) {
             table.parentNode.prepend(createButton());
        } else {
             console.error("FFN Exporter: Could not find content wrapper.");
        }
        return;
    }

    const exportBtn = createButton();
    
    // Injecting at the top of the wrapper puts it on the same line as the "Document Manager" text
    contentWrapper.prepend(exportBtn);

    function createButton() {
        const btn = document.createElement('button');
        btn.innerText = "📥 Export All to Markdown";
        
        // STYLE FIX: 
        // 1. float: right -> Pushes it to the far right of the container
        // 2. margin-bottom -> Ensures it doesn't overlap the table below it
        btn.style.cssText = `
            float: right;
            margin-right: 0px; 
            margin-bottom: 10px;
            padding: 6px 12px;
            font-family: Verdana, Arial;
            font-size: 13px;
            cursor: pointer;
            background-color: #f5f5f5;
            border: 1px solid #cdcdcd;
            border-radius: 4px;
            color: #333;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        `;
        
        // Hover effect for better UX
        btn.onmouseover = () => btn.style.background = "#e6e6e6";
        btn.onmouseout = () => btn.style.background = "#f5f5f5";
        
        return btn;
    }

    // --- 2. HELPER FUNCTIONS ---
    async function fetchDocContent(docId) {
        try {
            const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');

            const parsed = doc.querySelector('#story_text')?.value
                || doc.querySelector('#content')?.value
                || doc.querySelector('textarea')?.value
                || "";
            
            console.log(parsed);

            return parsed;
        } catch (e) {
            console.error("Fetch failed", e);
            return "";
        }
    }

    // --- 3. MAIN LOGIC ---
    exportBtn.onclick = async () => {
        const table = document.querySelector('#gui_table1');
        if (!table) return alert("Table #gui_table1 not found!");

        // Use 'tbody tr' to skip header rows if they exist
        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelectorAll('td').length > 0);
        
        if (rows.length === 0) return alert("No documents found.");

        const zip = new JSZip();
        const turndownService = new TurndownService();
        const originalText = exportBtn.innerText;

        // Visual Feedback
        exportBtn.disabled = true;
        exportBtn.style.opacity = "0.7";
        exportBtn.style.cursor = "wait";

        let successCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            
            // Link is usually in the 2nd cell (Title) or 4th cell (Action)
            const editLink = row.querySelector('a[href*="docid="]');
            if (!editLink) continue;

            const docIdMatch = editLink.href.match(/docid=(\d+)/);
            if (!docIdMatch) continue;
            const docId = docIdMatch[1];

            // Grab Title
            const titleCell = row.cells[1];
            let title = titleCell ? titleCell.innerText.trim() : `Doc_${docId}`;
            title = title.replace(/[/\\?%*:|"<>]/g, '-');

            exportBtn.innerText = `Fetching ${i + 1}/${rows.length}...`;

            try {
                const html = await fetchDocContent(docId);
                if (html && html.trim().length > 0) {
                    const markdown = turndownService.turndown(html);
                    zip.file(`${title}.md`, markdown);
                    successCount++;
                }
            } catch (err) {
                console.error(`Error processing ${title}`, err);
            }

            // 300ms delay to be polite to the server
            await new Promise(r => setTimeout(r, 300));
        }

        if (successCount === 0) {
            exportBtn.innerText = "❌ Error";
            alert("Could not extract any content.");
            exportBtn.disabled = false;
            return;
        }

        exportBtn.innerText = "📦 Zipping...";
        const blob = await zip.generateAsync({ type: "blob" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "FFN_Docs_Backup.zip";
        a.click();

        exportBtn.innerText = "✅ Done!";
        exportBtn.disabled = false;
        exportBtn.style.opacity = "1";
        exportBtn.style.cursor = "pointer";

        setTimeout(() => {
            exportBtn.innerText = originalText;
        }, 4000);
    };
})();