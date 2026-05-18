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
});
