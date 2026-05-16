import { afterEach, describe, it, expect, vi } from 'vitest';
import {
    applyExportTransforms,
    convertStyleAlignToAttr,
    appendFormatSeparator,
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
    it('strips the marker and all following content', () => {
        const input = '<p>Body</p>\nNotes:\n<p>Remove this</p>';

        expect(stripContentAfterMarker(input, 'Notes:')).toBe('<p>Body</p>\n');
    });

    it('adds one newline at the strip point when the marker is not already preceded by one', () => {
        const input = '<p>Body</p>Notes:\n<p>Remove this</p>';

        expect(stripContentAfterMarker(input, 'Notes:')).toBe('<p>Body</p>\n');
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
            return 0;
        });

        const result = applyExportTransforms(
            '<p>Body</p>\nNotes:\n<p>Remove this</p>',
            DocDownloadFormat.HTML,
            {
                convertLineBreaks: true,
                stripAfterMarker: 'Notes:',
            },
        );

        expect(result).toBe('<p>Body</p>\n<hr>\n<p>&nbsp;</p>');
    });
});
