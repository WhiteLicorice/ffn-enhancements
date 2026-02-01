// modules/DocEditor.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import { saveAs } from 'file-saver';

/**
 * Module responsible for enhancing the Document Editor page (`/docs/edit.php`).
 */
export const DocEditor = {
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
                this.injectToolbarButton(existingToolbar as HTMLElement);
                return;
            }

            // 2. Observer Strategy: Wait for injection
            log('Setting up MutationObserver for TinyMCE...');
            const observer = new MutationObserver((_mutations, obs) => {
                const toolbar = Core.getElement(Elements.EDITOR_TOOLBAR);
                if (toolbar) {
                    log('TinyMCE detected via Observer.');
                    obs.disconnect(); // Stop observing to save resources
                    this.injectToolbarButton(toolbar as HTMLElement);
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
     * Injects a custom download button into the TinyMCE toolbar.
     * Replicates the exact DOM structure of native TinyMCE 4 buttons to ensure
     * identical hover states and aesthetics.
     * @param toolbar - The toolbar HTMLElement to append the button to.
     */
    injectToolbarButton: function (toolbar: HTMLElement) {
        // 1. Container: Replicates the wrapper div structure
        // <div class="mce-widget mce-btn" tabindex="-1" role="button" aria-label="...">
        const container = document.createElement('div');
        container.className = 'mce-widget mce-btn';
        container.style.float = 'right'; // Keep our positioning
        container.setAttribute('tabindex', '-1');
        container.setAttribute('role', 'button');
        container.setAttribute('aria-label', 'Download Markdown');
        container.title = 'Download as Markdown'; // Native tooltip fallback

        // Manually toggle the hover class to ensure the theme applies the correct gradient/border
        container.onmouseenter = () => container.classList.add('mce-hover');
        container.onmouseleave = () => container.classList.remove('mce-hover');

        // 2. Inner Button: Presentation role only, just like native
        // <button role="presentation" type="button" tabindex="-1">
        const button = document.createElement('button');
        button.setAttribute('role', 'presentation');
        button.type = 'button';
        button.setAttribute('tabindex', '-1');

        // CSS to match native TinyMCE button metrics EXACTLY.
        // TinyMCE 4 buttons rely on padding + line-height to define their size, not explicit height.
        // Standard is padding: 4px and line-height: 20px -> Total Height ~28px-30px.
        button.style.cssText = `
            background: transparent; border: 0; margin: 0; 
            padding: 4px 8px; /* Standard padding for touch targets */
            outline: none; cursor: pointer; display: block;
            line-height: 20px; /* Crucial: Defines the vertical size of the button */
        `;

        // 3. Content: The Icon/Text
        // Simple span, no layout hacks needed if line-height is set on button
        button.innerHTML = '<span style="font-size: 14px; font-weight: bold; font-family: Arial, sans-serif;">↓</span>';

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