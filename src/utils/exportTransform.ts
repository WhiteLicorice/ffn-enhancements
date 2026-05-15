import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { SettingsManager } from '../modules/SettingsManager';

/**
 * Converts inline `style="text-align:*"` attributes to `align="*"` attributes
 * in the given HTML string. Ao3's TinyMCE rejects the style attribute but
 * accepts the align attribute on paragraph-level elements.
 */
export function convertStyleAlignToAttr(html: string): string {
    return html.replace(
        /style\s*=\s*"([^"]*text-align\s*:\s*(center|right|left|justify)[^"]*)"/gi,
        (_match: string, styleValue: string, align: string) => {
            const cleaned = styleValue
                .replace(
                    new RegExp(`\\s*text-align\\s*:\\s*${align}\\s*;?`, 'i'),
                    ''
                )
                .trim();
            const alignAttr = `align="${align.toLowerCase()}"`;
            if (cleaned) {
                return `style="${cleaned}" ${alignAttr}`;
            }
            return alignAttr;
        }
    );
}

/**
 * Appends format-specific separator with one newline above.
 */
export function appendFormatSeparator(
    content: string,
    format: DocDownloadFormat
): string {
    const trimmed = content.trimEnd();
    switch (format) {
        case DocDownloadFormat.MARKDOWN:
            return trimmed + '\n\n---';
        case DocDownloadFormat.HTML:
            return trimmed + '\n<hr>\n<p>&nbsp;</p>';
        case DocDownloadFormat.DOCX:
            return trimmed + '\n<hr>\n<p>&nbsp;</p>';
    }
}

function shouldSkipLinebreakNode(node: Text): boolean {
    const parent = node.parentElement;
    return !!parent && /^(PRE|CODE|SCRIPT|STYLE|TEXTAREA)$/i.test(parent.tagName);
}

export function convertTextLineBreaksToBr(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.body;
    if (!root) return html;

    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
        nodes.push(current as Text);
        current = walker.nextNode();
    }

    nodes.forEach(node => {
        if (!node.data.includes('\n') || shouldSkipLinebreakNode(node)) return;

        const parts = node.data.split(/\r?\n|\r/);
        if (parts.length < 2) return;

        const fragment = doc.createDocumentFragment();
        parts.forEach((part, index) => {
            if (part) fragment.appendChild(doc.createTextNode(part));
            if (index < parts.length - 1) fragment.appendChild(doc.createElement('br'));
        });
        node.replaceWith(fragment);
    });

    return root.innerHTML;
}

export interface ExportTransformOptions {
    forceAo3HtmlCompatibility?: boolean;
    convertLineBreaks?: boolean;
}

/**
 * Applies all enabled export transformations to content.
 *
 * 1. Ao3 HTML compatibility (only if format is HTML and setting is enabled).
 *    Not applied for DOCX — DocxBuilder reads `style` for its own alignment logic.
 * 2. Append end separator (if setting enabled, all formats).
 */
export function applyExportTransforms(
    content: string,
    format: DocDownloadFormat,
    options: ExportTransformOptions = {},
): string {
    let result = content;

    if (
        format === DocDownloadFormat.HTML &&
        (SettingsManager.get('ao3HtmlCompatibility') || options.forceAo3HtmlCompatibility)
    ) {
        result = convertStyleAlignToAttr(result);
    }

    if (format === DocDownloadFormat.HTML && options.convertLineBreaks) {
        result = convertTextLineBreaksToBr(result);
    }

    if (SettingsManager.get('appendSeparator')) {
        result = appendFormatSeparator(result, format);
    }

    return result;
}
