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
 * Appends format-specific separator with one newline above and one below.
 */
export function appendFormatSeparator(
    content: string,
    format: DocDownloadFormat
): string {
    const trimmed = content.trimEnd();
    switch (format) {
        case DocDownloadFormat.MARKDOWN:
            return trimmed + '---\n';
        case DocDownloadFormat.HTML:
            return trimmed + '<hr>\n<p>&nbsp;</p>';
        case DocDownloadFormat.DOCX:
            return trimmed + '<hr>\n<p>&nbsp;</p>';
    }
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
    format: DocDownloadFormat
): string {
    let result = content;

    if (
        format === DocDownloadFormat.HTML &&
        SettingsManager.get('ao3HtmlCompatibility')
    ) {
        result = convertStyleAlignToAttr(result);
    }

    if (SettingsManager.get('appendSeparator')) {
        result = appendFormatSeparator(result, format);
    }

    return result;
}
