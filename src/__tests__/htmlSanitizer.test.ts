import { describe, expect, it } from 'vitest';
import { sanitizeEditorHtml } from '../utils/htmlSanitizer';

describe('sanitizeEditorHtml', () => {
    it('strips active tags, handlers, and dangerous URLs', () => {
        const html = sanitizeEditorHtml(
            '<p onclick="alert(1)">Safe</p><a href="javascript:alert(1)" onmouseover="x()">Link</a><script>alert(1)</script><iframe src="https://evil.test"></iframe><style>.x{color:red}</style><link rel="stylesheet"><meta charset="utf-8">'
        );

        expect(html).toBe('<p>Safe</p>Link');
    });

    it('preserves basic formatting, alignment, breaks, rules, and image alt text', () => {
        const html = sanitizeEditorHtml(
            '<div style="text-align:center"><strong>Bold</strong> <em>Italic</em> <u>Under</u><br><img src="https://example.com/x.png" alt="Diagram"><hr></div><p align="left">Left</p>'
        );

        expect(html).toBe('<div align="center"><strong>Bold</strong> <em>Italic</em> <u>Under</u><br>Diagram<hr></div><p align="left">Left</p>');
    });

    it('preserves body content from full HTML documents and top-level text fragments', () => {
        expect(sanitizeEditorHtml('<!doctype html><html><head><title>Bad</title></head><body>Lead <p>Body</p></body></html>'))
            .toBe('Lead <p>Body</p>');
        expect(sanitizeEditorHtml('Loose text <strong>bold</strong>')).toBe('Loose text <strong>bold</strong>');
    });

    it('strips SVG, MathML, templates, and form controls', () => {
        const html = sanitizeEditorHtml(
            '<p>Before</p><svg onload="x()"><text>SVG</text></svg><math><mi>x</mi></math><template><p>Hidden</p></template><form><p>Keep</p><input value="x"><textarea>Hidden</textarea><button>Go</button></form><p>After</p>'
        );

        expect(html).toBe('<p>Before</p><p>Keep</p><p>After</p>');
    });

    it('keeps only allowed formatting and alignment from style attributes', () => {
        const html = sanitizeEditorHtml(
            '<p style="text-align:center;background-image:url(javascript:alert(1))" onclick="x()">Centered <span style="font-weight:700;background:url(https://evil.test/x)">Bold</span></p>'
        );

        expect(html).toBe('<p align="center">Centered <strong>Bold</strong></p>');
    });
});
