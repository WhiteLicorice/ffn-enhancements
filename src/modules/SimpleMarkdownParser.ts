// modules/SimpleMarkdownParser.ts

import { Core } from './Core';
import { marked } from 'marked';

/**
 * Robust Markdown Parser powered by the 'marked' library.
 * Handles detection and conversion following CommonMark standards.
 * Strategies allow for seamless integration into the Editor paste workflow.
 */
export const SimpleMarkdownParser = {
    /**
     * Checks if the input text contains intentional Markdown formatting.
     * It uses the library's lexer to see if any tokens other than plain text exist.
     * * @param text - The raw text content from the clipboard.
     * @returns True if structural or inline Markdown syntax is detected; false if plain text.
     */
    isMarkdown: function (text: string): boolean {
        const log = Core.getLogger('SimpleMarkdownParser', 'isMarkdown');
        const tokens = marked.lexer(text);

        // Deep search for any token that isn't just a basic paragraph/text.
        const hasFormatting = (tokenList: any[]): boolean => {
            return tokenList.some(token => {
                // If it's a structural element (Header, HR, List, Blockquote, Link, etc.)
                // We allow 'space' to pass as it's just whitespace.
                if (!['paragraph', 'text', 'space'].includes(token.type)) {
                    log(`Detected structural token: ${token.type}`);
                    return true;
                }

                // If it's a paragraph, check if it contains inline formatting (Bold, Italic, Code)
                if (token.tokens && hasFormatting(token.tokens)) {
                    // Note: We don't log here to avoid spamming for every bold word, 
                    // but the top-level return will indicate success.
                    return true;
                }

                return false;
            });
        };

        const result = hasFormatting(tokens);
        log(`Analysis complete. Is Markdown? ${result}`);
        return result;
    },

    /**
     * Converts Markdown string to HTML using the 'marked' library.
     * 'marked' handles edge cases like em-dashes vs HRs and nested lists natively.
     * * @param text - The raw Markdown text to convert.
     * @returns A string of HTML, ready for insertion into the TinyMCE editor.
     */
    parse: function (text: string): string {
        const log = Core.getLogger('SimpleMarkdownParser', 'parse');

        // Configure marked for security and standard behavior
        marked.setOptions({
            gfm: true,          // GitHub Flavored Markdown (Tables, Strikethrough)
            breaks: true,       // Convert \n to <br> (Essential for fiction writing flow)
            silent: true        // Don't throw errors on malformed MD, just parse what's possible
        });

        log('Converting Markdown content to HTML...');
        return marked.parse(text) as string;
    }
};