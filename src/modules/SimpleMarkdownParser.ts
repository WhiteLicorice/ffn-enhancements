// modules/SimpleMarkdownParser.ts

import { Core } from './Core';
import { Marked, type Token, type Tokens } from 'marked';

/**
 * Configured Marked instance that preserves literal single-tilde punctuation.
 * GFM by default treats `~text~` as strikethrough (`<del>`), which causes the
 * sanitizer to strip the tildes entirely. We disable the built-in del tokenizer
 * and re-add double-tilde-only deletion via an extension.
 */
const markedInstance = new Marked({
    gfm: true,
    breaks: true,
    silent: true,
});

const DOUBLE_TILDE_DEL_RE = /^(~~)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/;

// Override the built-in del tokenizer, which matches single ~text~.
// Returning undefined tells marked to treat unmatched tildes as literal text.
markedInstance.use({
    tokenizer: {
        del(src: string): Tokens.Del | undefined {
            const match = DOUBLE_TILDE_DEL_RE.exec(src);
            if (!match) return undefined;

            return {
                type: 'del',
                raw: match[0],
                text: match[2],
                tokens: this.lexer.inlineTokens(match[2]),
            };
        },
    },
});

/**
 * Robust Markdown Parser powered by the 'marked' library.
 * Handles detection and conversion following CommonMark standards.
 * Features a weighted heuristic to prevent hijacking standard document pastes.
 */
export const SimpleMarkdownParser = {
    MODULE_NAME: 'SimpleMarkdownParser',

    /**
     * Checks if the input text contains intentional Markdown formatting.
     * Uses a deep-search heuristic to distinguish between Markdown intent and accidental prose.
     * @param text - The raw text content from the clipboard.
     * @returns True if high-confidence Markdown syntax is detected; false if plain text.
     */
    isMarkdown: function (text: string): boolean {
        const log = Core.getLogger(this.MODULE_NAME, 'isMarkdown');

        // We trim to ensure leading whitespace doesn't trigger "indented code" logic prematurely
        const tokens = markedInstance.lexer(text.trim());

        /**
         * Recursive helper to scan tokens for "High Confidence" Markdown signals.
         * We ignore ambiguous signs (like URLs or dashes) to avoid breaking standard document pastes.
         */
        const hasIntentionalFormatting = (tokenList: Token[]): boolean => {
            return tokenList.some(token => {
                // 1. Content Baseline
                // These are ignored as triggers because they appear constantly in standard prose.
                // We exclude 'hr' and 'br' here to fix the "dashes in text" issue.
                // We exclude 'html' to allow native browser handling of raw HTML snippets.
                if (['paragraph', 'text', 'space', 'hr', 'br', 'html'].includes(token.type)) {
                    // Check children (inlines) of paragraphs
                    if ('tokens' in token && token.tokens && hasIntentionalFormatting(token.tokens)) return true;
                    return false;
                }

                // 2. High-Confidence Structural Triggers
                // Headings (#), Blockquotes (>), Tables, and GFM Strikethrough (~~) 
                // are very rare in standard prose and are strong signals of Markdown intent.
                if (['heading', 'blockquote', 'table', 'image', 'del'].includes(token.type)) {
                    log(`High-confidence trigger detected: ${token.type}`);
                    return true;
                }

                // 3. Specialized Check: Code Blocks
                // We ONLY trigger on "Fenced" code blocks (using backticks ```).
                // Standard indented code (4 spaces) is a major false positive for authors 
                // who use spaces to indent their paragraphs.
                if (token.type === 'code') {
                    const isFenced = token.raw.trim().startsWith('```') || token.raw.trim().startsWith('~~~');
                    if (isFenced) {
                        log('Detected fenced code block.');
                        return true;
                    }
                    return false;
                }

                // 4. Specialized Check: Links
                // Autolinks (just a URL) shouldn't trigger a hijack.
                // We only trigger on explicit Markdown bracketed links: [title](url).
                if (token.type === 'link') {
                    const isBracketed = token.raw.startsWith('[');
                    if (isBracketed) {
                        log('Detected bracketed Markdown link.');
                        return true;
                    }
                    return false;
                }

                // 5. Common Markers: Emphasis and Lists
                // These are the most common Markdown signs. While slightly ambiguous, 
                // their presence in plain-text copy-pastes usually indicates Markdown intent.
                if (['strong', 'em', 'list', 'codespan'].includes(token.type)) {
                    log(`Detected Markdown marker: ${token.type}`);
                    return true;
                }

                return false;
            });
        };

        const result = hasIntentionalFormatting(tokens);
        log(`Analysis complete. Is Markdown? ${result}`);
        return result;
    },

    /**
     * Converts Markdown string to HTML using the 'marked' library.
     * Configured specifically for the FanFiction.net editor environment.
     * @param text - The raw Markdown text to convert.
     * @returns A string of HTML, ready for insertion into the TinyMCE editor.
     */
    parse: function (text: string): string {
        const log = Core.getLogger(this.MODULE_NAME, 'parse');

        log('Converting Markdown content to HTML...');
        return markedInstance.parse(text) as string;
    }
};
