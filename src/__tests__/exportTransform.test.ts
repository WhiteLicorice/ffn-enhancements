import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    applyExportTransforms,
    convertStyleAlignToAttr,
    appendFormatSeparator,
    normalizeHtmlParagraphLines,
    stripContentAfterMarker,
} from '../utils/exportTransform';
import { DocDownloadFormat } from '../enums/DocDownloadFormat';
import { SettingsManager } from '../modules/SettingsManager';

afterEach(() => {
    vi.restoreAllMocks();
});

// ─── convertStyleAlignToAttr ───────────────────────────────────────────────

describe('convertStyleAlignToAttr', () => {
    it('converts text-align: center to align="center"', () => {
        const input = '<p style="text-align: center">Centered</p>';
        expect(convertStyleAlignToAttr(input))
            .toBe('<p align="center">Centered</p>');
    });

    it('converts text-align: right to align="right"', () => {
        const input = '<p style="text-align: right">Right</p>';
        expect(convertStyleAlignToAttr(input))
            .toBe('<p align="right">Right</p>');
    });

    it('converts text-align: left to align="left"', () => {
        const input = '<p style="text-align: left">Left</p>';
        expect(convertStyleAlignToAttr(input))
            .toBe('<p align="left">Left</p>');
    });

    it('converts text-align: justify to align="justify"', () => {
        const input = '<p style="text-align: justify">Justified</p>';
        expect(convertStyleAlignToAttr(input))
            .toBe('<p align="justify">Justified</p>');
    });

    it('preserves other style properties when removing text-align', () => {
        const input = '<p style="font-weight: bold; text-align: center; color: red">Styled</p>';
        const result = convertStyleAlignToAttr(input);
        expect(result).toContain('align="center"');
        expect(result).toContain('font-weight: bold');
        expect(result).toContain('color: red');
        expect(result).not.toContain('text-align');
    });

    it('handles text-align with trailing semicolon', () => {
        const input = '<p style="text-align: center;">Centered</p>';
        expect(convertStyleAlignToAttr(input))
            .toBe('<p align="center">Centered</p>');
    });

    it('handles single-quoted text-align and British centre values', () => {
        const input = "<p style='font-weight: bold; text-align: centre;'>Centered</p>";
        expect(convertStyleAlignToAttr(input))
            .toBe('<p style="font-weight: bold" align="center">Centered</p>');
    });

    it('handles multiple elements with text-align', () => {
        const input = '<p style="text-align: center">A</p><p style="text-align: right">B</p>';
        const result = convertStyleAlignToAttr(input);
        expect(result).toBe('<p align="center">A</p><p align="right">B</p>');
    });

    it('returns unchanged HTML when no text-align present', () => {
        const input = '<p>Normal</p><div style="color: red">Red</div>';
        expect(convertStyleAlignToAttr(input)).toBe(input);
    });

    it('handles empty string', () => {
        expect(convertStyleAlignToAttr('')).toBe('');
    });

    it('handles case-insensitive text-align values', () => {
        const input = '<p style="text-align: CENTER">Centered</p>';
        expect(convertStyleAlignToAttr(input))
            .toBe('<p align="center">Centered</p>');
    });

    it('removes entire style attr when text-align is the only property', () => {
        const input = '<div style="text-align: center"><p>Inner</p></div>';
        expect(convertStyleAlignToAttr(input))
            .toBe('<div align="center"><p>Inner</p></div>');
    });

    it('converts center tags to AO3-compatible aligned divs', () => {
        const input = '<center><p>Centered</p></center>';
        expect(convertStyleAlignToAttr(input))
            .toBe('<div align="center"><p>Centered</p></div>');
    });
});

// ─── appendFormatSeparator ─────────────────────────────────────────────────

describe('appendFormatSeparator', () => {
    it('appends --- for Markdown format', () => {
        const result = appendFormatSeparator('Hello', DocDownloadFormat.MARKDOWN);
        expect(result).toBe('Hello\n\n---');
    });

    it('appends <hr> for HTML format', () => {
        const result = appendFormatSeparator('<p>Hello</p>', DocDownloadFormat.HTML);
        expect(result).toBe('<p>Hello</p>\n<hr>\n<p>&nbsp;</p>');
    });

    it('appends <hr> for DOCX format', () => {
        const result = appendFormatSeparator('<p>Hello</p>', DocDownloadFormat.DOCX);
        expect(result).toBe('<p>Hello</p>\n<hr>\n<p>&nbsp;</p>');
    });

    it('trims trailing whitespace before appending', () => {
        const result = appendFormatSeparator('Hello   \n', DocDownloadFormat.MARKDOWN);
        expect(result).toBe('Hello\n\n---');
    });

    it('handles empty content', () => {
        expect(appendFormatSeparator('', DocDownloadFormat.HTML)).toBe('\n<hr>\n<p>&nbsp;</p>');
    });

    it('handles whitespace-only content', () => {
        const result = appendFormatSeparator('   ', DocDownloadFormat.MARKDOWN);
        expect(result).toBe('\n\n---');
    });
});

describe('stripContentAfterMarker', () => {
    it('strips the marker and all following content when the marker is standalone on one line', () => {
        const input = '<p>Body</p>\nNotes:\n<p>Remove this</p>';

        expect(stripContentAfterMarker(input, 'Notes:')).toBe('<p>Body</p>\n');
    });

    it('strips a standalone marker line wrapped in formatting and alignment tags', () => {
        const input = '<p>Body</p>\n<p align="center"><strong> Notes: </strong></p>\n<p>Remove this</p>';

        expect(stripContentAfterMarker(input, 'Notes:')).toBe('<p>Body</p>\n');
    });

    it('strips a standalone marker paragraph even when there are no literal newlines', () => {
        const input = '<p>Body</p><p align="center"><strong> Notes: </strong></p><p>Remove this</p>';

        expect(stripContentAfterMarker(input, 'Notes:')).toBe('<p>Body</p>');
    });

    it('does not strip an inline marker that is not standalone on its own line', () => {
        const input = '<p>Body</p>Notes:\n<p>Remove this</p>';

        expect(stripContentAfterMarker(input, 'Notes:')).toBe(input);
    });

    it('does not strip a marker inside a paragraph with surrounding content', () => {
        const input = '<p>Body Notes: still body text</p><p>Keep this</p>';

        expect(stripContentAfterMarker(input, 'Notes:')).toBe(input);
    });

    it('does not strip a line with other text around the marker', () => {
        const input = '<p>Body</p>\n<p>Notes: keep this context</p>\n<p>Keep this too</p>';

        expect(stripContentAfterMarker(input, 'Notes:')).toBe(input);
    });

    it('leaves content unchanged when the marker is blank or missing', () => {
        const input = '<p>Body</p>';

        expect(stripContentAfterMarker(input, '')).toBe(input);
        expect(stripContentAfterMarker(input, 'Notes:')).toBe(input);
    });

    it('does not turn the strip-point newline into a br before appending the HTML separator', () => {
        vi.spyOn(SettingsManager, 'get').mockImplementation((key: any) => {
            if (key === 'appendSeparator') return true;
            if (key === 'ao3HtmlCompatibility') return false;
            if (key === 'normalizeHtmlParagraphs') return true;
            return 0;
        });

        const result = applyExportTransforms(
            '<p>Body</p>\n<p><strong>Notes:</strong></p>\n<p>Remove this</p>',
            DocDownloadFormat.HTML,
            {
                convertLineBreaks: true,
                stripAfterMarker: 'Notes:',
            },
        );

        expect(result).toBe('<p>Body</p>\n<hr>\n<p>&nbsp;</p>');
    });
});

describe('normalizeHtmlParagraphLines', () => {
    it('flattens multiline prose paragraphs into single lines', () => {
        const input = '<p>First line\n    second line\nthird line</p>';

        expect(normalizeHtmlParagraphLines(input)).toBe('<p>First line second line third line</p>');
    });

    it('preserves nested inline tags while flattening whitespace', () => {
        const input = '<p>First\n    <em>second</em>\n    <strong>third</strong></p>';

        expect(normalizeHtmlParagraphLines(input)).toBe('<p>First <em>second</em> <strong>third</strong></p>');
    });

    it('preserves paragraph attributes', () => {
        const input = '<p class="intro" align="center">First\n    second</p>';

        expect(normalizeHtmlParagraphLines(input)).toBe('<p class="intro" align="center">First second</p>');
    });

    it('separates adjacent paragraphs with a blank line', () => {
        const input = '<p>First\n    paragraph.</p>\n<p><em>Second\n        paragraph.</em></p>';

        expect(normalizeHtmlParagraphLines(input)).toBe(
            '<p>First paragraph.</p>\n\n<p><em>Second paragraph.</em></p>',
        );
    });
});

describe('applyExportTransforms', () => {
    it('normalizes HTML paragraphs by default', () => {
        vi.spyOn(SettingsManager, 'get').mockImplementation((key: any) => {
            if (key === 'ao3HtmlCompatibility' || key === 'appendSeparator') return false;
            if (key === 'normalizeHtmlParagraphs') return true;
            return 0;
        });

        const result = applyExportTransforms(
            '<p>First line\n    second line</p><p>Third\n    line</p>',
            DocDownloadFormat.HTML,
        );

        expect(result).toBe('<p>First line second line</p>\n\n<p>Third line</p>');
    });

    it('does not normalize paragraphs when the HTML setting is disabled', () => {
        vi.spyOn(SettingsManager, 'get').mockImplementation((key: any) => {
            if (key === 'ao3HtmlCompatibility' || key === 'appendSeparator') return false;
            if (key === 'normalizeHtmlParagraphs') return false;
            return 0;
        });

        const input = '<p>First line\n    second line</p><p>Third\n    line</p>';

        expect(applyExportTransforms(input, DocDownloadFormat.HTML)).toBe(input);
    });

    it('leaves Markdown content unchanged', () => {
        vi.spyOn(SettingsManager, 'get').mockImplementation((key: any) => {
            if (key === 'ao3HtmlCompatibility' || key === 'appendSeparator') return false;
            if (key === 'normalizeHtmlParagraphs') return true;
            return 0;
        });

        const input = '<p>First line\n    second line</p>';

        expect(applyExportTransforms(input, DocDownloadFormat.MARKDOWN)).toBe(input);
    });

    it('keeps explicit line breaks as br before paragraph normalization runs', () => {
        vi.spyOn(SettingsManager, 'get').mockImplementation((key: any) => {
            if (key === 'ao3HtmlCompatibility' || key === 'appendSeparator') return false;
            if (key === 'normalizeHtmlParagraphs') return true;
            return 0;
        });

        const result = applyExportTransforms(
            '<p>Line 1\nLine 2</p><p>Line 3\nLine 4</p>',
            DocDownloadFormat.HTML,
            { convertLineBreaks: true },
        );

        expect(result).toBe('<p>Line 1<br>Line 2</p>\n\n<p>Line 3<br>Line 4</p>');
    });
});

// ─── Tilde preservation in exports ───────────────────────────────────────────

describe('export transforms preserve lone tildes', () => {
    it('HTML export preserves tildes in text content', () => {
        const result = applyExportTransforms(
            '<p>"Lorem ipsum~" Bob said.</p>',
            DocDownloadFormat.HTML,
        );
        expect(result).toContain('~');
    });

    it('Markdown export preserves tildes in text content', () => {
        const result = applyExportTransforms(
            '<p>"Lorem ipsum~" Bob said.</p>',
            DocDownloadFormat.MARKDOWN,
        );
        expect(result).toContain('~');
    });
});
