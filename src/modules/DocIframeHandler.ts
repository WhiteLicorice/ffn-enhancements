// modules/DocIframeHandler.ts

import { Core } from './Core';
import { SimpleMarkdownParser } from './SimpleMarkdownParser';
import { SettingsManager } from './SettingsManager';

/**
 * Shared utility for managing TinyMCE iframes across different FFN pages.
 * Handles the attachment of Markdown-aware paste listeners.
 */
export const DocIframeHandler = {
    MODULE_NAME: 'DocIframeHandler',

    /** * Stores the specific event listener function attached to a specific DOM element.
     * This allows us to retrieve and remove the exact anonymous function later.
     */
    /**
     * WeakMap<HTMLElement, EventListener> tracking paste listeners per iframe body.
     * WeakMap — not Map — so when TinyMCE replaces the iframe body (which it does
     * during editor re-init), the old body + its listener entry are GC-able. A Map
     * would leak the old body until explicitly deleted.
     */
    _listeners: new WeakMap<HTMLElement, EventListener>(),

    /**
     * Attaches a Markdown-aware paste listener to a target iframe.
     * If the iframe document isn't ready, it waits for the 'load' event.
     * @param iframe - The iframe element to enhance.
     */
    attachMarkdownPasterListener: function (iframe: HTMLIFrameElement) {
        const log = Core.getLogger(this.MODULE_NAME, 'attach');

        const setup = () => {
            const doc = iframe.contentDocument;

            // Check if doc and body exist
            if (doc && doc.body) {
                log('Attaching Paste Listener to Iframe body.');

                // 1. Check if we have already attached a listener to this specific body
                const existingListener = this._listeners.get(doc.body);

                // 2. If so, remove it to prevent duplicates (e.g., if re-initialized)
                if (existingListener) {
                    doc.body.removeEventListener('paste', existingListener);
                }

                // 3. Create a new specific listener for this context
                // We wrap the call to pass the 'iframe' reference
                const newListener = (e: Event) => this.handlePaste(e as ClipboardEvent, iframe);

                // 4. Store this new listener in the WeakMap so we can remove it later
                this._listeners.set(doc.body, newListener);

                // 5. Attach the listener
                doc.body.addEventListener('paste', newListener);
            }
        };

        if (iframe.contentDocument?.readyState === 'complete') {
            setup();
        } else {
            iframe.addEventListener('load', setup, { once: true });
        }
    },

    /**
     * Returns true if `text` looks like HTML source code.
     * Requires at least one block-level tag to avoid false positives on generic
     * code that contains angle brackets (e.g. TypeScript generics, XML snippets).
     */
    _isHtmlSource: function (text: string): boolean {
        return /<(p|div|h[1-6]|ul|ol|li|table|blockquote|pre|figure|article|section)\b[^>]*>/i.test(text.trim());
    },

    /**
     * Intercepts paste events within the iframe.
     * HTML source is checked first (more explicit); Markdown is checked second.
     * Each conversion path is independently gated by its own setting.
     *
     * Pastes that carry a `text/html` MIME type (Word, Google Docs, browser copy)
     * are skipped by default — TinyMCE's native handler already renders them as
     * rich text. `pasteForceIntercept` overrides this guard.
     */
    handlePaste: function (e: ClipboardEvent, iframe: HTMLIFrameElement) {
        const log = Core.getLogger(this.MODULE_NAME, 'handlePaste');
        const text = e.clipboardData?.getData('text/plain');
        if (!text) return;

        // Rich-source guard: if the clipboard carries text/html (e.g. a copy from
        // Word, Google Docs, or a browser selection), the content is already
        // rendered markup. Let TinyMCE handle it natively unless force-intercept
        // is enabled.
        if (!SettingsManager.get('pasteForceIntercept')) {
            const types = e.clipboardData?.types ?? [];
            const hasRichHtml = types.includes('text/html') &&
                (e.clipboardData?.getData('text/html') ?? '').trim().length > 0;
            if (hasRichHtml) return;
        }

        const convertHtml = SettingsManager.get('pasteConvertHtml');
        const convertMd   = SettingsManager.get('pasteConvertMarkdown');

        let htmlToInsert: string | null = null;
        let detected: string | null = null;

        // HTML check runs first — it is the more explicit/specific format.
        if (convertHtml && this._isHtmlSource(text)) {
            htmlToInsert = text;
            detected = 'HTML source';
        } else if (convertMd && SimpleMarkdownParser.isMarkdown(text)) {
            htmlToInsert = SimpleMarkdownParser.parse(text);
            detected = 'Markdown';
        }

        if (htmlToInsert !== null && iframe.contentDocument) {
            log(`${detected} detected. Intercepting paste.`);
            e.preventDefault();
            e.stopPropagation();
            // Note: execCommand('insertHTML') is deprecated but no practical
            // replacement exists for inserting HTML at cursor in a contenteditable.
            // ClipboardEvent-based approaches lose cursor position; Clipboard API
            // promises break on mixed content. Keep until browsers remove it.
            iframe.contentDocument.execCommand('insertHTML', false, htmlToInsert);
        }
    },
};