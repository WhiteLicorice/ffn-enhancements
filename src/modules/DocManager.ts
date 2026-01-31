import { Core } from './Core';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export const DocManager = {
    init: function () {
        Core.onDomReady(() => {
            if (document.querySelector('#gui_table1')) {
                this.injectUI();
            } else {
                Core.log('doc-manager', 'DocManager', 'Table not found. Waiting...');
                setTimeout(() => {
                    if (document.querySelector('#gui_table1')) this.injectUI();
                }, 1500);
            }
        });
    },

    injectUI: function () {
        this.injectBulkButton();
        this.injectTableColumn();
    },

    injectBulkButton: function () {
        Core.log('doc-manager', 'injectBulkButton', 'Attempting to inject UI...');
        const xpath = "//*[text()='Document Manager']";
        const textNode = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as HTMLElement;
        const container = textNode ? textNode.parentElement : document.querySelector('#content_wrapper_inner') as HTMLElement;

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

    injectTableColumn: function () {
        const func = 'injectTableColumn';
        const table = document.querySelector('#gui_table1') as HTMLTableElement;
        if (!table) return Core.log('doc-manager', func, 'Table not found.');

        const headerRow = table.querySelector('thead tr') || table.querySelector('tbody tr');

        if (headerRow) {
            const th = document.createElement('th');
            th.className = 'thead';
            th.innerText = 'Export';
            th.align = 'center';
            th.width = '5%';
            headerRow.appendChild(th);
        }

        const rows = table.querySelectorAll('tbody tr');
        rows.forEach((row: any) => {
            if (row.querySelector('th') || row.className.includes('thead')) return;
            const editLink = row.querySelector('a[href*="docid="]') as HTMLAnchorElement;
            if (!editLink) return;

            const td = document.createElement('td');
            td.align = 'center';
            td.vAlign = 'top';
            td.width = '5%';

            const docId = editLink.href.match(/docid=(\d+)/)![1];
            const title = row.cells[1].innerText.trim().replace(/[/\\?%*:|"<>]/g, '-');

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

    runBulkExport: async function (e: MouseEvent) {
        const func = 'runBulkExport';
        Core.log('doc-manager', func, 'Export initiated.');
        const btn = e.target as HTMLButtonElement;
        const table = document.querySelector('#gui_table1') as HTMLTableElement;

        if (!table) return alert("Error: Table not found.");

        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => row.querySelector('a[href*="docid="]'));
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
            await new Promise(r => setTimeout(r, 200));

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