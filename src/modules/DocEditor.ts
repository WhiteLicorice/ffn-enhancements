// modules/DocEditor.ts

import { Core } from './Core';
import { ContentParser } from '../services/ContentParser';
import { Elements } from '../enums/Elements';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { DocxBuilder } from './DocxBuilder';
import { SettingsManager } from './SettingsManager';
import { saveAs } from 'file-saver';
import { TinyMCEButtonFactory } from '../factories/TinyMCEButtonFactory';
import { DocIframeHandler } from './DocIframeHandler';
import { applyExportTransforms } from '../utils/exportTransform';
import { writeToClipboard } from '../utils/clipboard';

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

    /** Reference to the injected clipboard button (used for live tooltip updates). */
    clipBtn: null as HTMLElement | null,

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

            // Cross-tab sync: update both button tooltips when another tab
            // changes docDownloadFormat via the settings page.
            SettingsManager.subscribe('docDownloadFormat', (newVal) => {
                if (this.downloadBtn) {
                    const tooltip = newVal === DocDownloadFormat.DOCX
                        ? 'Export Document as DOCX'
                        : newVal === DocDownloadFormat.HTML
                            ? 'Export Document as HTML'
                            : 'Export Document as Markdown';
                    this.downloadBtn.title = tooltip;
                    log(`Download button tooltip updated to: "${tooltip}"`);
                }
                if (this.clipBtn) {
                    const clipTooltip = this._clipTooltip(newVal);
                    const ariaLabel = this.clipBtn.getAttribute('aria-label');
                    if (ariaLabel) this.clipBtn.setAttribute('aria-label', clipTooltip);
                    log(`Clipboard button tooltip updated to: "${clipTooltip}"`);
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
        const exportTooltip = format === DocDownloadFormat.DOCX
            ? 'Export Document (DOCX)'
            : format === DocDownloadFormat.HTML
                ? 'Export Document (HTML)'
                : 'Export Document (Markdown)';
        const dlContent = '<span style="font-size: 14px; font-weight: bold; font-family: Arial, sans-serif;">↓</span>';
        const dlBtn = TinyMCEButtonFactory.create(
            exportTooltip,
            dlContent,
            () => this.exportCurrentDoc()
        );

        // Store reference so the subscriber in init() can update the tooltip live.
        this.downloadBtn = dlBtn;
        this.injectToolbarButton(dlBtn);

        // Clipboard button
        const clipTooltip = this._clipTooltip(format);
        const clipBtn = TinyMCEButtonFactory.create(
            clipTooltip,
            '<span style="font-size: 14px; font-weight: bold; font-family: Arial, sans-serif;">' + '⧉' + '</span>',
            () => this.clipboardCurrentDoc()
        );

        // Store reference so the subscriber in init() can update the tooltip live.
        this.clipBtn = clipBtn;
        this.injectToolbarButton(clipBtn);
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
     * Returns tooltip text for clipboard button reflecting current format.
     */
    _clipTooltip: function (format: DocDownloadFormat): string {
        if (format === DocDownloadFormat.DOCX) return 'Copy to Clipboard as DOCX';
        if (format === DocDownloadFormat.HTML) return 'Copy to Clipboard as HTML';
        return 'Copy to Clipboard as Markdown';
    },

    /**
     * Reads current HTML content directly from TinyMCE iframe body.
     * More reliable than reading from textarea (no sync delay).
     */
    _getEditorHtml: function (): string | null {
        if (!this.editorIframe?.contentDocument?.body) return null;
        const html = this.editorIframe.contentDocument.body.innerHTML;
        return html || null;
    },

    /**
     * Orchestrates the export of the currently open document.
     * The output format (Markdown or HTML) is read from SettingsManager at call time,
     * so changes made via the Tampermonkey menu take effect on the next click.
     * Uses FileSaver to trigger the browser download.
     */
    exportCurrentDoc: async function () {
        const log = Core.getLogger(this.MODULE_NAME, 'exportCurrentDoc');
        const title = this.getTitle();
        const format = SettingsManager.get('docDownloadFormat');

        try {
            const html = this._getEditorHtml();
            if (!html) {
                log('No HTML content found in editor.');
                return;
            }

            if (format === DocDownloadFormat.DOCX) {
                const transformed = applyExportTransforms(html, format);
                const blob = await DocxBuilder.build(transformed, title);
                saveAs(blob, `${title}.docx`);
            } else if (format === DocDownloadFormat.HTML) {
                const transformed = applyExportTransforms(html, format);
                saveAs(new Blob([transformed], { type: "text/html;charset=utf-8" }), `${title}.html`);
            } else {
                const markdown = ContentParser.turndownService.turndown(html);
                const transformed = applyExportTransforms(markdown, format);
                saveAs(new Blob([transformed], { type: "text/markdown;charset=utf-8" }), `${title}.md`);
            }
        } catch (e) {
            log('CRITICAL ERROR', e);
        }
    },

    /**
     * Copies the currently open document's content to the system clipboard.
     * Applies export transforms (Ao3 HTML compatibility, append separator).
     * For DOCX format: writes the HTML source to clipboard as HTML.
     */
    clipboardCurrentDoc: async function () {
        const log = Core.getLogger(this.MODULE_NAME, 'clipboardCurrentDoc');
        const title = this.getTitle();
        const format = SettingsManager.get('docDownloadFormat');

        log(`Starting clipboard export for "${title}" as ${format}`);

        const html = this._getEditorHtml();
        if (!html) {
            log('No HTML content found in editor.');
            this._showToast('No content to copy', true);
            return;
        }

        try {
            let content: string;
            let isHtml: boolean;

            if (format === DocDownloadFormat.DOCX) {
                // DOCX clipboard: write rendered HTML (rich paste).
                content = html;
                isHtml = true;
            } else if (format === DocDownloadFormat.HTML) {
                // HTML clipboard: write raw HTML source as plain text (like Markdown writes raw Markdown).
                content = html;
                isHtml = false;
            } else {
                content = ContentParser.turndownService.turndown(html);
                isHtml = false;
            }

            const effectiveFormat = format === DocDownloadFormat.DOCX
                ? DocDownloadFormat.HTML
                : format;
            const transformed = applyExportTransforms(content, effectiveFormat);

            const success = await writeToClipboard(transformed, isHtml);

            if (success) {
                log(`Clipboard export successful for "${title}"`);
                this._showToast('Copied to clipboard!', false);
            } else {
                log(`Clipboard export failed for "${title}"`);
                this._showToast('Clipboard copy failed', true);
            }
        } catch (e) {
            log('Clipboard export error', e);
            this._showToast('Clipboard error', true);
        }
    },

    /**
     * Shows a temporary toast notification.
     * @param message - The message to display.
     * @param isError - If true, styles the toast as an error (red).
     */
    _showToast: function (message: string, isError: boolean) {
        const existing = document.getElementById('ffne-clipboard-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'ffne-clipboard-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; z-index: 999999;
            padding: 10px 20px; border-radius: 6px;
            font-family: Arial, sans-serif; font-size: 14px;
            color: #fff; background-color: ${isError ? '#e74c3c' : '#27ae60'};
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }
};