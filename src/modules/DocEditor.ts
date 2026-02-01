// modules/DocEditor.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import { saveAs } from 'file-saver';
import { TinyMCEButtonFactory } from '../factories/TinyMCEButtonFactory';

/**
 * Module responsible for enhancing the Document Editor page (`/docs/edit.php`).
 */
export const DocEditor = {
    /** Cached reference to the editor toolbar element. */
    toolbar: null as HTMLElement | null,

    /**
     * Initializes the module by waiting for the DOM and observing for the TinyMCE instance.
     * Uses MutationObserver to react instantly when the toolbar is injected, preventing UI flicker.
     */
    init: function () {
        const log = Core.getLogger('doc-editor', 'init');

        Core.onDomReady(() => {
            // 1. Fast Path: Check if it's already there
            const existingToolbar = Core.getElement(Elements.EDITOR_TOOLBAR);
            if (existingToolbar) {
                log('TinyMCE found immediately.');
                this.toolbar = existingToolbar;
                this.setupDownloadButton();
                return;
            }

            // 2. Observer Strategy: Wait for injection
            log('Setting up MutationObserver for TinyMCE...');
            const observer = new MutationObserver((_mutations, obs) => {
                const toolbar = Core.getElement(Elements.EDITOR_TOOLBAR);
                if (toolbar) {
                    log('TinyMCE detected via Observer.');
                    obs.disconnect(); // Stop observing to save resources
                    this.toolbar = toolbar;
                    this.setupDownloadButton();
                }
            });

            // Observe the body subtree because TinyMCE injects deep into the DOM
            observer.observe(document.body, { childList: true, subtree: true });

            // 3. Safety Timeout: Stop observing after 10s if it never loads
            setTimeout(() => {
                observer.disconnect();
            }, 10000);
        });
    },

    /**
     * Constructs the specific "Download Markdown" button using the Factory
     * and injects it into the toolbar.
     */
    setupDownloadButton: function () {
        // Content: Simple span, no layout hacks needed if line-height is set on button
        const content = '<span style="font-size: 14px; font-weight: bold; font-family: Arial, sans-serif;">↓</span>';
        
        const btn = TinyMCEButtonFactory.create(
            'Download Markdown',
            content,
            () => this.exportCurrentDoc()
        );

        this.injectToolbarButton(btn);
    },

    /**
     * Injects a pre-constructed button into the cached TinyMCE toolbar.
     * @param button - The fully constructed DOM element to append.
     */
    injectToolbarButton: function (button: HTMLElement) {
        if (this.toolbar) {
            this.toolbar.appendChild(button);
        } else {
            Core.log('doc-editor', 'injectToolbarButton', 'Toolbar reference missing.');
        }
    },

    /**
     * Extracts metadata (Title, Word Count) from the FFN header string.
     * Looks for "Edit Document: [Title] - [Count] word(s)".
     * @returns An object containing the title and word count, or null if parsing fails.
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
     * @returns A sanitized string suitable for use as a filename.
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
     * Uses FileSaver to trigger the browser download.
     */
    exportCurrentDoc: function () {
        const log = Core.getLogger('doc-editor', 'exportCurrentDoc');
        const title = this.getTitle();

        try {
            const markdown = Core.parseContentFromPrivateDoc(document, title);
            if (markdown) {
                saveAs(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${title}.md`);
            }
        } catch (e) {
            log('CRITICAL ERROR', e);
        }
    }
};