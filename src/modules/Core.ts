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
     * @param pagePath - window.location.pathname
     */
    setDelegate: function (pagePath: string) {
        const func = 'setDelegate';

        if (pagePath.startsWith('/s/')) {
            this.activeDelegate = StoryDelegate;
            this.log('Core', func, 'Strategy set to StoryDelegate');
        }
        else if (pagePath === "/docs/docs.php") {
            this.activeDelegate = DocManagerDelegate;
            this.log('Core', func, 'Strategy set to DocManagerDelegate');
        }
        else if (pagePath.includes("/docs/edit.php")) {
            this.activeDelegate = DocEditorDelegate;
            this.log('Core', func, 'Strategy set to DocEditorDelegate');
        }
        else {
            this.log('Core', func, 'No specific delegate found for this path.');
        }
    },

    /**
     * The Public API for fetching UI elements.
     * Modules call this instead of document.querySelector.
     * Implements Chain of Responsibility: Specific Delegate -> Global Delegate.
     * @param key - The Element Enum key.
     */
    getElement: function (key: Elements): any {
        let el = null;

        // 1. Try the Page-Specific Strategy first (if active)
        if (this.activeDelegate) {
            el = this.activeDelegate.get(key);
        }

        // 2. If not found (or no active delegate), try the Global Strategy
        if (!el) {
            el = GlobalDelegate.get(key);
        }

        // 3. Logging / Error Handling
        if (!el) {
            // Optional: Log strict warnings for debugging
            this.log('Core', 'getElement', `Selector failed for key: ${key}`);
        }

        return el;
    },

    // ==========================================
    // CONTENT PARSING
    // ==========================================

    /**
     * Extracts text from a DOM object and converts to Markdown.
     * Used for both live page parsing and background fetch parsing.
     * @param doc - The document object to query.
     * @param title - The title of the content (for logging purposes).
     * @returns The converted Markdown string, or null if selectors fail.
     */
    parseContentFromDOM: function (doc: Document, title: string) {
        const func = 'Core.parseContent';

        // Note: We don't use the Delegate here because 'doc' might be an
        // iframe or a fetched HTML string, not the active 'document'.
        // We keep these hardcoded selectors for robustness on background fetches.
        const contentElement = (doc.querySelector("textarea[name='bio']") ||
            doc.querySelector("#story_text") ||
            doc.querySelector("#content")) as HTMLTextAreaElement | HTMLElement;

        if (!contentElement) {
            this.log('init', func, `Selectors failed for "${title}"`);
            return null;
        }

        const rawValue = (contentElement as HTMLTextAreaElement).value || contentElement.innerHTML;
        return this.turndownService.turndown(rawValue);
    },

    /**
     * Fetches a specific DocID and returns the Markdown content.
     * @param docId - The internal FFN Document ID.
     * @param title - The title of the document.
     * @returns A promise resolving to the Markdown string or null.
     */
    fetchAndConvertDoc: async function (docId: string, title: string) {
        const func = 'Core.fetchAndConvert';
        try {
            const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
            if (!response.ok) {
                this.log('init', func, `Network Error for ${docId}: ${response.status}`);
                return null;
            }

            const text = await response.text();
            const doc = new DOMParser().parseFromString(text, 'text/html');
            const markdown = this.parseContentFromDOM(doc, title);

            if (markdown) {
                this.log('init', func, `Content extracted for "${title}". Length: ${markdown.length}`);
                return markdown;
            }
        } catch (err) {
            this.log('init', func, `Error processing ${title}`, err);
        }
        return null;
    }
};