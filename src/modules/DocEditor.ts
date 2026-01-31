// modules/DocEditor.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import { saveAs } from 'file-saver';

/**
 * Module responsible for enhancing the Document Editor page (`/docs/edit.php`).
 */
export const DocEditor = {
    /**
     * Initializes the module by waiting for the DOM and polling for the TinyMCE instance.
     */
    init: function () {
        Core.onDomReady(() => {
            Core.log('doc-editor', 'DocEditor', 'Polling for TinyMCE...');
            const checkInt = setInterval(() => {
                const toolbar = Core.getElement(Elements.EDITOR_TOOLBAR);
                if (toolbar) {
                    clearInterval(checkInt);
                    this.injectToolbarButton(toolbar as HTMLElement);
                }
            }, 500);
            setTimeout(() => { if (checkInt) clearInterval(checkInt); }, 5000);
        });
    },

    /**
     * Injects a custom download button into the TinyMCE toolbar.
     * @param toolbar - The toolbar HTMLElement to append the button to.
     */
    injectToolbarButton: function (toolbar: HTMLElement) {
        const container = document.createElement('div');
        container.className = 'mce-widget mce-btn';
        container.style.float = 'right';
        container.setAttribute('aria-label', 'Download Markdown');
        container.setAttribute('role', 'button');

        const button = document.createElement('button');
        button.style.cssText = 'padding: 4px 6px; font-size: 14px; display: flex; align-items: center; justify-content: center; background: transparent; border: 0; outline: none;';
        button.innerHTML = '↓';
        button.title = "Download as Markdown";

        button.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.exportCurrentDoc();
        };

        container.appendChild(button);
        toolbar.appendChild(container);
    },

    /**
     * Extracts metadata (Title, Word Count) from the FFN header string.
     * Looks for "Edit Document: [Title] - [Count] word(s)".
     */
    parseDocumentHeader: function () {
        const headerEl = Core.getElement(Elements.EDITOR_HEADER_LABEL) as HTMLElement;
        if (!headerEl) return null;

        let textContent = null;
        for (const node of headerEl.childNodes) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim().startsWith("Edit Document:")) {
                textContent = node.textContent.trim();
                break;
            }
        }

        if (!textContent) return null;
        const match = textContent.match(/Edit Document:\s*(.+?)\s*-\s*([\d,]+)\s*word\(s\)/);
        return match ? { title: match[1].trim(), wordCount: match[2].trim() } : null;
    },

    /**
     * Retrieves the document title from the header or fallback input field.
     * Sanitizes the title for use as a filename.
     */
    getTitle: function () {
        const headerData = this.parseDocumentHeader();
        let title = headerData ? headerData.title : null;
        if (!title) {
            const titleInput = Core.getElement(Elements.EDITOR_TITLE_INPUT) as HTMLInputElement;
            if (titleInput) title = titleInput.value.trim();
        }
        return title ? title.replace(/[/\\?%*:|"<>]/g, '-') : 'Untitled_Draft';
    },

    /**
     * Orchestrates the export of the currently open document to Markdown.
     */
    exportCurrentDoc: function () {
        const func = 'DocEditor.export';
        const title = this.getTitle();
        try {
            const markdown = Core.parseContentFromDOM(document, title);
            if (markdown) {
                saveAs(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${title}.md`);
            }
        } catch (e) {
            Core.log('doc-editor', func, 'CRITICAL ERROR', e);
        }
    }
};