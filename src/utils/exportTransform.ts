import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { SettingsManager } from '../modules/SettingsManager';

/**
 * Converts inline `style="text-align:*"` attributes to `align="*"` attributes
 * in the given HTML string. Ao3's TinyMCE rejects the style attribute but
 * accepts the align attribute on paragraph-level elements.
 */
export function convertStyleAlignToAttr(html: string): string {
    return html
        .replace(/<\s*center\b([^>]*)>/gi, (_match: string, attrs: string) => `<div${attrs || ''} align="center">`)
        .replace(/<\/\s*center\s*>/gi, '</div>')
        .replace(
            /style\s*=\s*(["'])(.*?)\1/gi,
            (match: string, _quote: string, styleValue: string) => {
                let align: string | null = null;
                const remainingDeclarations = styleValue
                    .split(';')
                    .map(declaration => declaration.trim())
                    .filter(Boolean)
                    .filter(declaration => {
                        const [rawProperty, ...rawValueParts] = declaration.split(':');
                        const property = rawProperty.trim().toLowerCase();
                        const value = rawValueParts.join(':').trim().toLowerCase();
                        if (property !== 'text-align') return true;

                        const normalizedAlign = value === 'centre' ? 'center' : value;
                        if (!['center', 'right', 'left', 'justify'].includes(normalizedAlign)) {
                            return true;
                        }

                        align = normalizedAlign;
                        return false;
                    });

                if (!align) return match;

                const alignAttr = `align="${align}"`;
                if (remainingDeclarations.length > 0) {
                    return `style="${remainingDeclarations.join('; ')}" ${alignAttr}`;
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

export function normalizeHtmlParagraphLines(html: string): string {
    return html
        .replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, (paragraph: string) => {
            const openTagMatch = paragraph.match(/^<p\b[^>]*>/i);
            const closeTagMatch = paragraph.match(/<\/p>$/i);
            if (!openTagMatch || !closeTagMatch) return paragraph;

            const openTag = openTagMatch[0];
            const closeTag = closeTagMatch[0];
            const innerHtml = paragraph.slice(openTag.length, -closeTag.length)
                .replace(/\s*[\r\n]+\s*/g, ' ')
                .trim();

            return `${openTag}${innerHtml}${closeTag}`;
        })
        .replace(/<\/p>\s*(<p\b[^>]*>)/gi, '</p>\n\n$1');
}

interface StripMarkerResult {
    content: string;
    stripped: boolean;
    preserveTerminalLineBreak: boolean;
}

function decodeBasicHtmlEntities(value: string): string {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function normalizeStandaloneMarkerLine(value: string): string {
    return decodeBasicHtmlEntities(value)
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function findStandaloneMarkerLineStart(content: string, normalizedMarker: string): number {
    const linePattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
    let lineStartIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = linePattern.exec(content)) !== null) {
        const [fullLine, lineText, lineEnding] = match;
        if (fullLine === '' && lineEnding === '') break;

        if (normalizeStandaloneMarkerLine(lineText) === normalizedMarker) {
            return lineStartIndex;
        }

        lineStartIndex += fullLine.length;
        if (lineEnding === '') break;
    }

    return -1;
}

function findStandaloneMarkerBlockStart(content: string, normalizedMarker: string): number {
    const blockPattern = /<\s*(p|div|center|h[1-6]|li|blockquote)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi;
    let match: RegExpExecArray | null;

    while ((match = blockPattern.exec(content)) !== null) {
        if (normalizeStandaloneMarkerLine(match[0]) === normalizedMarker) {
            return match.index;
        }
    }

    return -1;
}

function stripContentAfterMarkerWithResult(content: string, marker: string | undefined): StripMarkerResult {
    const normalizedMarker = normalizeStandaloneMarkerLine(marker?.trim() || '');
    if (!normalizedMarker) {
        return { content, stripped: false, preserveTerminalLineBreak: false };
    }

    const lineStart = findStandaloneMarkerLineStart(content, normalizedMarker);
    const blockStart = findStandaloneMarkerBlockStart(content, normalizedMarker);
    const markerStart = [lineStart, blockStart]
        .filter(index => index >= 0)
        .sort((a, b) => a - b)[0];

    if (markerStart !== undefined) {
        const strippedContent = content.slice(0, markerStart);
        return {
            content: strippedContent,
            stripped: true,
            preserveTerminalLineBreak: /[\r\n]$/.test(strippedContent),
        };
    }

    return { content, stripped: false, preserveTerminalLineBreak: false };
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
 * 2. Optional literal line-break conversion for HTML.
 * 3. Optional HTML paragraph line normalization for HTML.
 * 4. Append end separator (if setting enabled, all formats).
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

    if (format === DocDownloadFormat.HTML && SettingsManager.get('normalizeHtmlParagraphs')) {
        result = normalizeHtmlParagraphLines(result);
    }

    if (SettingsManager.get('appendSeparator')) {
        result = appendFormatSeparator(result, format);
    }

    return result;
}
