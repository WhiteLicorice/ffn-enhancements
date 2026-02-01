// modules/DocIframeHandler.ts

import { Core } from './Core';
import { SimpleMarkdownParser } from './SimpleMarkdownParser';

/**
 * Shared utility for managing TinyMCE iframes across different FFN pages.
 * Handles the attachment of Markdown-aware paste listeners.
 */
export const DocIframeHandler = {
    /** * Stores the specific event listener function attached to a specific DOM element.
     * This allows us to retrieve and remove the exact anonymous function later.
     */
    _listeners: new WeakMap<HTMLElement, EventListener>(),

    /**
     * Attaches a Markdown-aware paste listener to a target iframe.
     * If the iframe document isn't ready, it waits for the 'load' event.
     * @param iframe - The iframe element to enhance.
     */
    attachMarkdownPasterListener: function (iframe: HTMLIFrameElement) {
        const log = Core.getLogger('DocIframeHandler', 'attach');

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
     * Intercepts paste events within the iframe.
     * If Markdown is detected, it parses it to HTML and inserts it.
     */
    handlePaste: function (e: ClipboardEvent, iframe: HTMLIFrameElement) {
        const log = Core.getLogger('DocIframeHandler', 'handlePaste');
        const text = e.clipboardData?.getData('text/plain');

        if (text && SimpleMarkdownParser.isMarkdown(text)) {
            log('Markdown detected. Intercepting paste.');
            e.preventDefault();
            e.stopPropagation();

            const parsedHtml = SimpleMarkdownParser.parse(text);
            if (iframe.contentDocument) {
                iframe.contentDocument.execCommand('insertHTML', false, parsedHtml);
            }
        }
    }
};