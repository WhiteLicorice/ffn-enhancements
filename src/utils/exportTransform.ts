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

export function convertTextLineBreaksToBr(html: string): string {
    const skipTags = new Set(['pre', 'code', 'script', 'style', 'textarea']);
    let result = '';
    let textBuffer = '';
    let tagBuffer = '';
    let inTag = false;
    let skipDepth = 0;

    const flushTextBuffer = () => {
        if (!textBuffer) return;
        result += skipDepth > 0
            ? textBuffer
            : textBuffer.replace(/\r?\n|\r/g, '<br>');
        textBuffer = '';
    };

    const updateSkipDepth = (tagText: string) => {
        const match = tagText.match(/^<\s*(\/?)\s*([a-z0-9:-]+)/i);
        if (!match) return;

        const [, closingSlash, tagNameRaw] = match;
        const tagName = tagNameRaw.toLowerCase();
        if (!skipTags.has(tagName) || /\/\s*>$/.test(tagText)) return;

        if (closingSlash) {
            skipDepth = Math.max(0, skipDepth - 1);
        } else {
            skipDepth++;
        }
    };

    for (let index = 0; index < html.length; index++) {
        const char = html[index];
        if (inTag) {
            tagBuffer += char;
            if (char === '>') {
                inTag = false;
                result += tagBuffer;
                updateSkipDepth(tagBuffer);
                tagBuffer = '';
            }
            continue;
        }

        if (char === '<') {
            flushTextBuffer();
            inTag = true;
            tagBuffer = '<';
            continue;
        }

        textBuffer += char;
    }

    flushTextBuffer();
    if (tagBuffer) result += tagBuffer;
    return result;
}

interface StripMarkerResult {
    content: string;
    stripped: boolean;
    preserveTerminalLineBreak: boolean;
}

function stripContentAfterMarkerWithResult(content: string, marker: string | undefined): StripMarkerResult {
    const normalizedMarker = marker?.trim() || '';
    if (!normalizedMarker) {
        return { content, stripped: false, preserveTerminalLineBreak: false };
    }

    const markerIndex = content.indexOf(normalizedMarker);
    if (markerIndex === -1) {
        return { content, stripped: false, preserveTerminalLineBreak: false };
    }

    let strippedContent = content.slice(0, markerIndex);
    if (!/[\r\n]$/.test(strippedContent)) {
        strippedContent += '\n';
    }

    return {
        content: strippedContent,
        stripped: true,
        preserveTerminalLineBreak: /[\r\n]$/.test(strippedContent),
    };
}

export function stripContentAfterMarker(content: string, marker: string | undefined): string {
    return stripContentAfterMarkerWithResult(content, marker).content;
}

export interface ExportTransformOptions {
    forceAo3HtmlCompatibility?: boolean;
    convertLineBreaks?: boolean;
    stripAfterMarker?: string;
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
    const stripResult = stripContentAfterMarkerWithResult(content, options.stripAfterMarker);
    let result = stripResult.content;

    if (
        format === DocDownloadFormat.HTML &&
        (SettingsManager.get('ao3HtmlCompatibility') || options.forceAo3HtmlCompatibility)
    ) {
        result = convertStyleAlignToAttr(result);
    }

    if (format === DocDownloadFormat.HTML && options.convertLineBreaks) {
        const terminalLineBreak = stripResult.preserveTerminalLineBreak
            ? result.match(/(\r\n|\r|\n)$/)?.[0] || ''
            : '';
        if (terminalLineBreak) {
            result = convertTextLineBreaksToBr(result.slice(0, -terminalLineBreak.length)) + terminalLineBreak;
        } else {
            result = convertTextLineBreaksToBr(result);
        }
    }

    if (SettingsManager.get('appendSeparator')) {
        result = appendFormatSeparator(result, format);
    }

    return result;
}
