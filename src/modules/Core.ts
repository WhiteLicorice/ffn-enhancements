// modules/Core.ts

import TurndownService from 'turndown';
import { Elements } from '../enums/Elements';
import { StoryDelegate } from '../delegates/StoryDelegate';
import { IDelegate } from '../delegates/IDelegate';
import { DocManagerDelegate } from '../delegates/DocManagerDelegate';
import { DocEditorDelegate } from '../delegates/DocEditorDelegate';
import { GlobalDelegate } from '../delegates/GlobalDelegate';

/**
 * Shared utility engine providing logging, DOM readiness, content parsing,
 * and the central Broker for the Delegate (Page Object) system.
 */
export const Core = {
    MODULE_NAME: 'core',

    /**
     * Instance of TurndownService configured for converting HTML to Markdown.
     * Configured with horizontal rule and bullet list markers.
     */
    turndownService: new TurndownService({
        'hr': '---',
        'bulletListMarker': '-',
    }),  // modern-ish presets used by Markor and the like

    /**
     * The currently active Delegate strategy (Story vs Doc vs Global).
     */
    activeDelegate: null as IDelegate | null,

    /**
     * Centralized logging function with standardized formatting.
     * @param page_name - The context/module name (e.g., 'doc-manager').
     * @param funcName - The specific function generating the log.
     * @param msg - The message to log.
     * @param data - Optional data object to log alongside the message.
     */
    log: function (page_name: string, funcName: string, msg: string, data?: any) {
        const prefix = `(ffn-enhancements) ${page_name} ${funcName}:`;
        if (data !== undefined) console.log(`${prefix} ${msg}`, data);
        else console.log(`${prefix} ${msg}`);
    },

    /**
     * Logger Factory: Returns a bound logging function for a specific context.
     * This prevents manual repetition of page and function names in every log call.
     * @param page_name - The context/module name.
     * @param funcName - The specific function name.
     * @returns A function that accepts (msg, data).
     */
    getLogger: function (page_name: string, funcName: string) {
        return (msg: string, data?: any) => {
            this.log(page_name, funcName, msg, data);
        };
    },

    /**
     * Runs a callback when the DOM is fully loaded.
     * Essential for userscripts running at 'document-start'.
     * @param callback - The function to execute once the DOM is ready.
     */
    onDomReady: function (callback: () => void) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else {
            callback();
        }
    },

    // ==========================================
    // DELEGATE SYSTEM
    // ==========================================

    /**
     * Determines which Delegate strategy to use based on the current URL path.
     * This abstracts away the DOM differences between Story pages and Doc pages.
     * @param pagePath - window.location.pathname
     */
    setDelegate: function (pagePath: string) {
        const log = this.getLogger(this.MODULE_NAME, 'setDelegate');

        if (pagePath.startsWith('/s/')) {
            this.activeDelegate = StoryDelegate;
            log('Strategy set to StoryDelegate');
        }
        else if (pagePath === "/docs/docs.php") {
            this.activeDelegate = DocManagerDelegate;
            log('Strategy set to DocManagerDelegate');
        }
        else if (pagePath.includes("/docs/edit.php")) {
            this.activeDelegate = DocEditorDelegate;
            log('Strategy set to DocEditorDelegate');
        }
        else {
            log('No specific delegate found for this path.');
        }
    },

    /**
     * Public API: Fetches a SINGLE element.
     * Guaranteed to return an HTMLElement or null. No Arrays.
     * Implements Chain of Responsibility: Specific Delegate -> Global Delegate.
     * @param key - The Element Enum key.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns The found HTMLElement or null.
     */
    getElement: function (key: Elements, doc?: Document): HTMLElement | null {
        const log = this.getLogger(this.MODULE_NAME, 'getElement');
        let el: HTMLElement | null = null;

        // 1. Try Page-Specific
        if (this.activeDelegate) {
            el = this.activeDelegate.getElement(key, doc);
        }

        // 2. Try Global
        if (!el) {
            el = GlobalDelegate.getElement(key, doc);
        }

        // 3. Logging / Error Handling
        if (!el) {
            log(`Selector failed for key: ${key}`);
        }

        return el;
    },

    /**
     * Public API: Fetches a LIST of elements.
     * Guaranteed to return an Array. No nulls.
     * Implements Chain of Responsibility: Specific Delegate -> Global Delegate.
     * @param key - The Element Enum key.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns An array of HTMLElements (empty if none found).
     */
    getElements: function (key: Elements, doc?: Document): HTMLElement[] {
        let els: HTMLElement[] = [];

        // 1. Try Page-Specific
        if (this.activeDelegate) {
            els = this.activeDelegate.getElements(key, doc);
        }

        // 2. Try Global (only if page specific returned nothing)
        if (els.length === 0) {
            els = GlobalDelegate.getElements(key, doc);
        }

        return els;
    },

    // ==========================================
    // CONTENT PARSING
    // ==========================================

    /**
     * Extracts text from a private author-accessible document and converts it to Markdown.
     * Used for both live page parsing and background fetch parsing.
     * @param doc - The document object to query.
     * @param title - The title of the content (for logging purposes).
     * @returns The converted Markdown string, or null if selectors fail.
     */
    parseContentFromPrivateDoc: function (doc: Document, title: string) {
        const log = this.getLogger(this.MODULE_NAME, 'parseContentFromPrivateDoc');
        const contentElement = this.getElement(Elements.EDITOR_TEXT_AREA, doc);

        if (!contentElement) {
            log(`Selectors failed for "${title}"`);
            return null;
        }

        const rawValue = (contentElement as HTMLTextAreaElement).value || contentElement.innerHTML;
        return this.turndownService.turndown(rawValue);
    },

    /**
     * Fetches a specific DocID of an author-accessible document and returns the Markdown content.
     * Includes Exponential Backoff to handle FFN's rate limiting (429).
     * @param docId - The internal FFN Document ID.
     * @param title - The title of the document.
     * @param attempt - (Internal) Current retry attempt number.
     * @returns A promise resolving to the Markdown string or null.
     */
    fetchAndConvertPrivateDoc: async function (docId: string, title: string, attempt = 1): Promise<string | null> {
        const log = this.getLogger(this.MODULE_NAME, 'fetchAndConvertPrivateDoc');
        const MAX_RETRIES = 3;

        try {
            const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);

            // --- Rate Limit Handling ---
            if (response.status === 429) {
                if (attempt <= MAX_RETRIES) {
                    const waitTime = attempt * 2000; // 2s, 4s, 6s...
                    log(`Rate limited (429) for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt})`);
                    await new Promise(r => setTimeout(r, waitTime));
                    return this.fetchAndConvertPrivateDoc(docId, title, attempt + 1);
                }
                log(`Rate limit exceeded for "${title}". Please wait a moment.`);
                return null;
            }

            if (!response.ok) {
                log(`Network Error for ${docId}: ${response.status}`);
                return null;
            }

            const text = await response.text();
            const doc = new DOMParser().parseFromString(text, 'text/html');
            const markdown = this.parseContentFromPrivateDoc(doc, title);

            if (markdown) {
                log(`Content extracted for "${title}". Length: ${markdown.length}`);
                return markdown;
            }
        } catch (err) {
            log(`Error processing ${title}`, err);
        }
        return null;
    }
};