// modules/DocEditor.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { SettingsManager } from './SettingsManager';
import { saveAs } from 'file-saver';
import { TinyMCEButtonFactory } from '../factories/TinyMCEButtonFactory';
import { DocIframeHandler } from './DocIframeHandler';

/**
 * Module responsible for enhancing the Document Editor page (`/docs/edit.php`).
 */
export const DocEditor = {
    MODULE_NAME: 'doc-editor',

    /** Cached reference to the editor toolbar element. */
    toolbar: null as HTMLElement | null,

    /** Reference to the editor iframe where content lives. */
    editorIframe: null as HTMLIFrameElement | null,

    /** Reference to the injected download button (used for live tooltip updates). */
    downloadBtn: null as HTMLElement | null,

    /**
     * Initializes the module by waiting for the DOM and observing for the TinyMCE instance.
     * Uses MutationObserver to react instantly when the toolbar is injected, preventing UI flicker.
     */
    init: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'init');

        Core.onDomReady(() => {
            // 1. Fast Path: Check if it's already there
            const existingToolbar = Core.getElement(Elements.EDITOR_TOOLBAR);
            if (existingToolbar) {
                log('TinyMCE found immediately.');
                this.handleEditorFound(existingToolbar);
            } else {
                // 2. Observer Strategy: Wait for injection
                log('Setting up MutationObserver for TinyMCE...');
                const observer = new MutationObserver((_mutations, obs) => {
                    const toolbar = Core.getElement(Elements.EDITOR_TOOLBAR);
                    if (toolbar) {
                        log('TinyMCE detected via Observer.');
                        obs.disconnect();
                        this.handleEditorFound(toolbar);
                    }
                });

                // Observe the body subtree because TinyMCE injects deep into the DOM
                observer.observe(document.body, { childList: true, subtree: true });

                // 3. Safety Timeout: Stop observing after 10s if it never loads
                setTimeout(() => {
                    observer.disconnect();
                }, 10000);
            }

            // Cross-tab sync: update the download button tooltip when another tab
            // changes docDownloadFormat via the settings page.
            SettingsManager.subscribe('docDownloadFormat', (newVal) => {
                if (this.downloadBtn) {
                    const tooltip = newVal === DocDownloadFormat.HTML
                        ? 'Export Document (HTML)'
                        : 'Export Document (Markdown)';
                    this.downloadBtn.title = tooltip;
                    log(`Download button tooltip updated to: "${tooltip}"`);
                }
            });
        });
    },

    /**
     * Common handler for when the Editor DOM is located.
     */
    handleEditorFound: function (toolbar: HTMLElement) {
        this.toolbar = toolbar;
        this.setupButtons();
        this.setupPasteHandler();
    },

    /**
     * Sets up the toolbar buttons.
     * The download button tooltip reflects the current format setting at the
     * time the editor toolbar is found. It updates live when the setting changes
     * via the settings page (handled by the `docDownloadFormat` subscriber in init()).
     */
    setupButtons: function () {
        const format = SettingsManager.get('docDownloadFormat');
        const tooltip = format === DocDownloadFormat.HTML ? 'Export Document (HTML)' : 'Export Document (Markdown)';
        const dlContent = '<span style="font-size: 14px; font-weight: bold; font-family: Arial, sans-serif;">↓</span>';
        const dlBtn = TinyMCEButtonFactory.create(
            tooltip,
            dlContent,
            () => this.exportCurrentDoc()
        );

        // Store reference so the subscriber in init() can update the tooltip live.
        this.downloadBtn = dlBtn;
        this.injectToolbarButton(dlBtn);
    },

    /**
     * Injects a pre-constructed button into the cached TinyMCE toolbar.
     * @param button - The fully constructed DOM element to append.
     */
    injectToolbarButton: function (button: HTMLElement) {
        if (this.toolbar) {
            this.toolbar.appendChild(button);
        } else {
            Core.log(this.MODULE_NAME, 'injectToolbarButton', 'Toolbar reference missing.');
        }
    },

    /**
     * Locates the Editor Iframe and delegates paste handling to the shared module.
     */
    setupPasteHandler: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'setupPasteHandler');

        const iframe = Core.getElement(Elements.EDITOR_TEXT_AREA_IFRAME) as HTMLIFrameElement;

        if (!iframe) {
            log('Editor Iframe not found. Retrying in 1s...');
            setTimeout(() => this.setupPasteHandler(), 1000);
            return;
        }

        this.editorIframe = iframe;
        DocIframeHandler.attachMarkdownPasterListener(iframe);
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
     * Orchestrates the export of the currently open document.
     * The output format (Markdown or HTML) is read from SettingsManager at call time,
     * so changes made via the Tampermonkey menu take effect on the next click.
     * Uses FileSaver to trigger the browser download.
     */
    exportCurrentDoc: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'exportCurrentDoc');
        const title = this.getTitle();
        const format = SettingsManager.get('docDownloadFormat');

        try {
            if (format === DocDownloadFormat.HTML) {
                const html = Core.parseHtmlFromPrivateDoc(document, title);
                if (html) {
                    saveAs(new Blob([html], { type: "text/html;charset=utf-8" }), `${title}.html`);
                }
            } else {
                const markdown = Core.parseContentFromPrivateDoc(document, title);
                if (markdown) {
                    saveAs(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${title}.md`);
                }
            }
        } catch (e) {
            log('CRITICAL ERROR', e);
        }
    }
};