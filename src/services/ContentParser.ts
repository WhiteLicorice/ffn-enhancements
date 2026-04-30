// services/ContentParser.ts

import TurndownService from 'turndown';
import { Core } from '../modules/Core';
import { Elements } from '../enums/Elements';

/**
 * Content parsing service for FFN private author documents.
 * Handles HTML extraction and Markdown conversion using Turndown.
 */
export const ContentParser = {
    MODULE_NAME: 'ContentParser',

    /**
     * Instance of TurndownService configured for converting HTML to Markdown.
     * Configured with horizontal rule and bullet list markers.
     */
    turndownService: new TurndownService({
        'hr': '---',
        'bulletListMarker': '-',
    }),

    /**
     * Extracts the raw HTML/text content from a private author-accessible document.
     * Reads from the editor textarea value (plain-text HTML source) or its innerHTML.
     * @param doc - The document object to query.
     * @param title - The title of the content (for logging purposes).
     * @returns The raw HTML string, or null if the selector fails.
     */
    parseHtmlFromPrivateDoc: function (doc: Document, title: string): string | null {
        const log = Core.getLogger(this.MODULE_NAME, 'parseHtmlFromPrivateDoc');
        const contentElement = Core.getElement(Elements.EDITOR_TEXT_AREA, doc);

        if (!contentElement) {
            log(`Selectors failed for "${title}"`);
            return null;
        }

        return (contentElement as HTMLTextAreaElement).value || contentElement.innerHTML;
    },

    /**
     * Extracts text from a private author-accessible document and converts it to Markdown.
     * Wraps `parseHtmlFromPrivateDoc` with a Turndown conversion step.
     * Used for both live page parsing and background fetch parsing.
     * @param doc - The document object to query.
     * @param title - The title of the content (for logging purposes).
     * @returns The converted Markdown string, or null if selectors fail.
     */
    parseContentFromPrivateDoc: function (doc: Document, title: string): string | null {
        const raw = this.parseHtmlFromPrivateDoc(doc, title);
        if (!raw) return null;
        return this.turndownService.turndown(raw);
    },
};
