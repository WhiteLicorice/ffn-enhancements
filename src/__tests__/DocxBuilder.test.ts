import { describe, it, expect } from 'vitest';
import { DocxBuilder } from '../modules/DocxBuilder';
import JSZip from 'jszip';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse HTML and return just the paragraphs array (ignore hyperlinks for most tests). */
function parse(html: string) {
    const result = DocxBuilder._parseHtmlToParagraphs(html);
    return { paragraphs: result.paragraphs, hyperlinks: result.hyperlinks };
}

// ─── Layer 1: HTML → OoxmlParagraph conversion ───────────────────────────

describe('DocxBuilder._parseHtmlToParagraphs', () => {
    it('returns empty array for empty input', () => {
        expect(parse('').paragraphs).toEqual([]);
    });

    it('returns empty array for whitespace-only input', () => {
        expect(parse('   \n  \t  ').paragraphs).toEqual([]);
    });

    it('returns empty array for null/undefined equivalent', () => {
        expect(parse('').paragraphs).toEqual([]);
    });

    it('converts plain paragraph with single text run', () => {
        const { paragraphs } = parse('<p>Hello world</p>');
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].children).toHaveLength(1);
        expect(paragraphs[0].children[0]).toEqual({ text: 'Hello world' });
    });

    it('converts bold text', () => {
        const { paragraphs } = parse('<p>Hello <strong>bold</strong> text</p>');
        expect(paragraphs).toHaveLength(1);
        const runs = paragraphs[0].children;
        expect(runs).toHaveLength(3);
        expect(runs[0]).toEqual({ text: 'Hello ' });
        expect(runs[1]).toEqual({ text: 'bold', bold: true });
        expect(runs[2]).toEqual({ text: ' text' });
    });

    it('converts <b> as bold', () => {
        const { paragraphs } = parse('<p>Hello <b>bold</b></p>');
        expect(paragraphs[0].children[1]).toEqual({ text: 'bold', bold: true });
    });

    it('converts italic text', () => {
        const { paragraphs } = parse('<p>Hello <em>italic</em> text</p>');
        expect(paragraphs[0].children[1]).toEqual({ text: 'italic', italic: true });
    });

    it('converts <i> as italic', () => {
        const { paragraphs } = parse('<p>Hello <i>italic</i></p>');
        expect(paragraphs[0].children[1]).toEqual({ text: 'italic', italic: true });
    });

    it('converts underline', () => {
        const { paragraphs } = parse('<p>Hello <u>underlined</u></p>');
        expect(paragraphs[0].children[1]).toEqual({ text: 'underlined', underline: true });
    });

    it('converts strikethrough', () => {
        const { paragraphs } = parse('<p>Hello <s>struck</s></p>');
        expect(paragraphs[0].children[1]).toEqual({ text: 'struck', strikethrough: true });
    });

    it('handles nested formatting', () => {
        const { paragraphs } = parse('<p><strong>bold <em>and italic</em></strong></p>');
        expect(paragraphs).toHaveLength(1);
        const runs = paragraphs[0].children;
        expect(runs).toHaveLength(2);
        expect(runs[0]).toEqual({ text: 'bold ', bold: true });
        expect(runs[1]).toEqual({ text: 'and italic', bold: true, italic: true });
    });

    it('converts h1 heading', () => {
        const { paragraphs } = parse('<h1>Title</h1>');
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].style).toBe('Heading1');
        expect(paragraphs[0].children[0]).toEqual({ text: 'Title' });
    });

    it('converts h2 heading', () => {
        const { paragraphs } = parse('<h2>Section</h2>');
        expect(paragraphs[0].style).toBe('Heading2');
    });

    it('converts h3 heading', () => {
        const { paragraphs } = parse('<h3>Subsection</h3>');
        expect(paragraphs[0].style).toBe('Heading3');
    });

    it('treats h4 as bold paragraph (not a heading style)', () => {
        const { paragraphs } = parse('<h4>Minor heading</h4>');
        expect(paragraphs[0].style).toBeUndefined();
        expect(paragraphs[0].children[0]).toEqual({ text: 'Minor heading', bold: true });
    });

    it('converts unordered list', () => {
        const { paragraphs } = parse('<ul><li>Item 1</li><li>Item 2</li></ul>');
        expect(paragraphs).toHaveLength(2);
        expect(paragraphs[0].numbering).toEqual({ id: 1, level: 0 });
        expect(paragraphs[0].children[0]).toEqual({ text: 'Item 1' });
        expect(paragraphs[1].numbering).toEqual({ id: 1, level: 0 });
        expect(paragraphs[1].children[0]).toEqual({ text: 'Item 2' });
    });

    it('converts ordered list', () => {
        const { paragraphs } = parse('<ol><li>First</li><li>Second</li></ol>');
        expect(paragraphs).toHaveLength(2);
        expect(paragraphs[0].numbering).toEqual({ id: 2, level: 0 });
        expect(paragraphs[1].numbering).toEqual({ id: 2, level: 0 });
    });

    it('converts nested lists', () => {
        const { paragraphs } = parse('<ul><li>Item<ul><li>Nested</li></ul></li></ul>');
        expect(paragraphs).toHaveLength(2);
        expect(paragraphs[0].numbering).toEqual({ id: 1, level: 0 });
        expect(paragraphs[0].children[0]).toEqual({ text: 'Item' });
        expect(paragraphs[1].numbering).toEqual({ id: 1, level: 1 });
        expect(paragraphs[1].children[0]).toEqual({ text: 'Nested' });
    });

    it('converts blockquote with indentation', () => {
        const { paragraphs } = parse('<blockquote><p>Quoted text</p></blockquote>');
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].indentation).toEqual({ left: 720, right: 720 });
        expect(paragraphs[0].children[0]).toEqual({ text: 'Quoted text' });
    });

    it('stacks indentation for nested blockquotes', () => {
        const { paragraphs } = parse('<blockquote><blockquote><p>Deep quote</p></blockquote></blockquote>');
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].indentation).toEqual({ left: 1440, right: 1440 });
    });

    it('converts horizontal rule to page-break paragraph', () => {
        const { paragraphs } = parse('<hr>');
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].isPageBreak).toBe(true);
    });

    it('converts line breaks within paragraphs', () => {
        const { paragraphs } = parse('<p>Line 1<br>Line 2</p>');
        expect(paragraphs).toHaveLength(1);
        const children = paragraphs[0].children;
        expect(children).toHaveLength(3);
        expect(children[0]).toEqual({ text: 'Line 1' });
        expect(children[1]).toEqual({ text: '', lineBreak: true });
        expect(children[2]).toEqual({ text: 'Line 2' });
    });

    it('converts hyperlinks with rId assignment', () => {
        const { paragraphs, hyperlinks } = parse('<p>Visit <a href="https://example.com">Example</a></p>');
        expect(paragraphs).toHaveLength(1);
        const children = paragraphs[0].children;
        expect(children).toHaveLength(2);
        expect(children[0]).toEqual({ text: 'Visit ' });

        if ('rId' in children[1]) {
            expect(children[1].url).toBe('https://example.com');
            expect(children[1].runs[0]).toEqual({ text: 'Example' });
            expect(hyperlinks.get(children[1].rId)).toBe('https://example.com');
        } else {
            throw new Error('Expected hyperlink child');
        }
    });

    it('reuses rIds for duplicate URLs', () => {
        const { paragraphs, hyperlinks } = parse(
            '<p><a href="https://x.com">X</a> and <a href="https://x.com">X again</a></p>'
        );
        const children = paragraphs[0].children;
        // children: [hyperlink("X"), text(" and "), hyperlink("X again")]
        expect(children).toHaveLength(3);
        const rId1 = 'rId' in children[0] ? children[0].rId : '';
        const rId2 = 'rId' in children[2] ? children[2].rId : '';
        expect(rId1).toBe(rId2);
        expect(rId1).toBeTruthy();
        expect(hyperlinks.size).toBe(1);
    });

    it('handles image with alt text', () => {
        const { paragraphs } = parse('<p>Text <img src="x.jpg" alt="Diagram"> end</p>');
        expect(paragraphs[0].children[1]).toEqual({ text: 'Diagram' });
    });

    it('falls back to [Image] for images without alt', () => {
        const { paragraphs } = parse('<p><img src="x.jpg"></p>');
        expect(paragraphs[0].children[0]).toEqual({ text: '[Image]' });
    });

    it('skips HTML comments', () => {
        const { paragraphs } = parse('<p>Before<!-- comment -->After</p>');
        expect(paragraphs).toHaveLength(1);
        const texts = paragraphs[0].children.map(c => 'text' in c ? c.text : '').join('');
        expect(texts).toBe('BeforeAfter');
    });

    it('converts <div> as paragraph', () => {
        const { paragraphs } = parse('<div>Content in div</div>');
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].children[0]).toEqual({ text: 'Content in div' });
    });

    it('applies center alignment from div style', () => {
        const { paragraphs } = parse('<div style="text-align: center">Centered</div>');
        expect(paragraphs[0].alignment).toBe('center');
    });

    it('applies right alignment from div style', () => {
        const { paragraphs } = parse('<div style="text-align: right">Right</div>');
        expect(paragraphs[0].alignment).toBe('right');
    });

    it('handles <span style="font-weight: bold"> formatting', () => {
        const { paragraphs } = parse('<p>Normal <span style="font-weight: bold">bold span</span></p>');
        expect(paragraphs[0].children[1]).toEqual({ text: 'bold span', bold: true });
    });

    it('handles <span style="font-style: italic"> formatting', () => {
        const { paragraphs } = parse('<p>Normal <span style="font-style: italic">italic span</span></p>');
        expect(paragraphs[0].children[1]).toEqual({ text: 'italic span', italic: true });
    });

    it('handles inline formatting inside list items', () => {
        const { paragraphs } = parse('<ul><li>Item with <strong>bold</strong> text</li></ul>');
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].numbering).toEqual({ id: 1, level: 0 });
        expect(paragraphs[0].children).toHaveLength(3);
        expect(paragraphs[0].children[0]).toEqual({ text: 'Item with ' });
        expect(paragraphs[0].children[1]).toEqual({ text: 'bold', bold: true });
        expect(paragraphs[0].children[2]).toEqual({ text: ' text' });
    });

    it('handles text nodes at body level', () => {
        const { paragraphs } = parse('Plain text without tags');
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].children[0]).toEqual({ text: 'Plain text without tags' });
    });

    it('converts <pre> content preserving text', () => {
        const { paragraphs } = parse('<pre>  preformatted  </pre>');
        expect(paragraphs).toHaveLength(1);
        expect(paragraphs[0].children[0]).toEqual({ text: '  preformatted  ' });
    });

    it('handles deeply nested inline formatting', () => {
        const { paragraphs } = parse('<p><strong><em><u>All three</u></em></strong></p>');
        expect(paragraphs[0].children[0]).toEqual({
            text: 'All three', bold: true, italic: true, underline: true,
        });
    });

    it('handles multiple block elements', () => {
        const { paragraphs } = parse('<p>First</p><p>Second</p><p>Third</p>');
        expect(paragraphs).toHaveLength(3);
        const t0 = paragraphs[0].children[0] as { text?: string };
        const t1 = paragraphs[1].children[0] as { text?: string };
        const t2 = paragraphs[2].children[0] as { text?: string };
        expect(t0.text).toBe('First');
        expect(t1.text).toBe('Second');
        expect(t2.text).toBe('Third');
    });

    it('handles empty paragraphs from malformed HTML gracefully', () => {
        const { paragraphs } = parse('<p></p><p><br></p>');
        // Empty <p> has no children, so it may be omitted; <p><br></p> has a line break
        // The parser skips paragraphs with no children and no br
        expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    });

    it('converts <ins> as underline', () => {
        const { paragraphs } = parse('<p><ins>inserted</ins></p>');
        expect(paragraphs[0].children[0]).toEqual({ text: 'inserted', underline: true });
    });

    it('converts <del> as strikethrough', () => {
        const { paragraphs } = parse('<p><del>deleted</del></p>');
        expect(paragraphs[0].children[0]).toEqual({ text: 'deleted', strikethrough: true });
    });
});

// ─── Layer 2: XML Generation ──────────────────────────────────────────────

describe('DocxBuilder._generateDocumentXml', () => {
    it('generates valid OOXML with w:document root', () => {
        const paras = [{ children: [{ text: 'Hello' }] }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:document');
        expect(xml).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"');
        expect(xml).toContain('<w:body>');
        expect(xml).toContain('</w:body>');
        expect(xml).toContain('</w:document>');
    });

    it('includes relationship namespace when hyperlinks exist', () => {
        const paras = [{ children: [{ text: 'Hello' }] }];
        const hyperlinks = new Map([['rId1', 'https://example.com']]);
        const xml = DocxBuilder._generateDocumentXml(paras, hyperlinks);
        expect(xml).toContain('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
    });

    it('emits heading style in paragraph properties', () => {
        const paras = [{ children: [{ text: 'Title' }], style: 'Heading1' as const }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    });

    it('emits bold run property', () => {
        const paras = [{ children: [{ text: 'Bold', bold: true }] }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:b/>');
    });

    it('emits italic run property', () => {
        const paras = [{ children: [{ text: 'Italic', italic: true }] }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:i/>');
    });

    it('emits underline run property', () => {
        const paras = [{ children: [{ text: 'Under', underline: true }] }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:u w:val="single"/>');
    });

    it('emits strikethrough run property', () => {
        const paras = [{ children: [{ text: 'Strike', strikethrough: true }] }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:strike/>');
    });

    it('escapes XML special characters in text', () => {
        const paras = [{ children: [{ text: 'A & B < C > D' }] }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('A &amp; B &lt; C &gt; D');
    });

    it('emits numbering properties', () => {
        const paras = [{ children: [{ text: 'Item' }], numbering: { id: 1, level: 0 } }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:ilvl w:val="0"/>');
        expect(xml).toContain('<w:numId w:val="1"/>');
    });

    it('emits indentation properties', () => {
        const paras = [{ children: [{ text: 'Quote' }], indentation: { left: 720, right: 720 } }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:ind w:left="720" w:right="720"/>');
    });

    it('emits hyperlink with r:id', () => {
        const paras = [{
            children: [
                { rId: 'rId4', url: 'https://x.com', runs: [{ text: 'link' }] },
            ],
        }];
        const hyperlinks = new Map([['rId4', 'https://x.com']]);
        const xml = DocxBuilder._generateDocumentXml(paras, hyperlinks);
        expect(xml).toContain('<w:hyperlink r:id="rId4">');
        expect(xml).toContain('<w:rStyle w:val="Hyperlink"/>');
    });

    it('emits horizontal rule border', () => {
        const paras = [{ children: [{ text: '' }], isPageBreak: true }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:pBdr>');
        expect(xml).toContain('<w:bottom w:val="single"');
    });

    it('emits line break', () => {
        const paras = [{ children: [{ text: '', lineBreak: true }] }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('<w:br/>');
    });

    it('strips XML-invalid control characters from text', () => {
        const paras = [{ children: [{ text: 'Before\x00Middle\x1FAfter' }] }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml).toContain('BeforeMiddleAfter');
        expect(xml).not.toContain('\x00');
    });

    it('generates XML declaration', () => {
        const paras = [{ children: [{ text: 'Test' }] }];
        const xml = DocxBuilder._generateDocumentXml(paras, new Map());
        expect(xml.startsWith('<?xml')).toBe(true);
    });
});

// ─── Layer 3: ZIP Structure ────────────────────────────────────────────────

describe('DocxBuilder._buildZip', () => {
    it('returns a Blob with DOCX MIME type', async () => {
        const blob = await DocxBuilder._buildZip(
            [{ children: [{ text: 'Hello' }] }],
            'Test',
            new Map(),
        );
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });

    it('creates a valid ZIP archive with required files', async () => {
        const blob = await DocxBuilder._buildZip(
            [{ children: [{ text: 'Hello' }] }],
            'Test',
            new Map(),
        );
        const zip = await JSZip.loadAsync(blob);

        expect(Object.keys(zip.files)).toContain('[Content_Types].xml');
        expect(Object.keys(zip.files)).toContain('_rels/.rels');
        expect(Object.keys(zip.files)).toContain('word/document.xml');
        expect(Object.keys(zip.files)).toContain('word/styles.xml');
        expect(Object.keys(zip.files)).toContain('word/numbering.xml');
    });

    it('includes hyperlink relationships when hyperlinks exist', async () => {
        const hyperlinks = new Map([['rId1', 'https://example.com']]);
        const blob = await DocxBuilder._buildZip(
            [{ children: [{ text: 'Hello' }] }],
            'Test',
            hyperlinks,
        );
        const zip = await JSZip.loadAsync(blob);
        expect(Object.keys(zip.files)).toContain('word/_rels/document.xml.rels');
    });

    it('omits hyperlink relationships when none exist', async () => {
        const blob = await DocxBuilder._buildZip(
            [{ children: [{ text: 'Hello' }] }],
            'Test',
            new Map(),
        );
        const zip = await JSZip.loadAsync(blob);
        expect(Object.keys(zip.files)).not.toContain('word/_rels/document.xml.rels');
    });

    it('writes valid document.xml content', async () => {
        const blob = await DocxBuilder._buildZip(
            [{ children: [{ text: 'Hello World' }] }],
            'Test',
            new Map(),
        );
        const zip = await JSZip.loadAsync(blob);
        const docXml = await zip.file('word/document.xml')!.async('string');
        expect(docXml).toContain('Hello World');
        expect(docXml).toContain('<w:document');
    });

    it('writes valid content types', async () => {
        const blob = await DocxBuilder._buildZip(
            [{ children: [{ text: 'Hello' }] }],
            'Test',
            new Map(),
        );
        const zip = await JSZip.loadAsync(blob);
        const ctXml = await zip.file('[Content_Types].xml')!.async('string');
        expect(ctXml).toContain('document.main+xml');
        expect(ctXml).toContain('styles+xml');
        expect(ctXml).toContain('numbering+xml');
    });

    it('writes valid rels', async () => {
        const blob = await DocxBuilder._buildZip(
            [{ children: [{ text: 'Hello' }] }],
            'Test',
            new Map(),
        );
        const zip = await JSZip.loadAsync(blob);
        const relsXml = await zip.file('_rels/.rels')!.async('string');
        expect(relsXml).toContain('officeDocument');
        expect(relsXml).toContain('word/document.xml');
    });
});

// ─── End-to-end via build() ────────────────────────────────────────────────

describe('DocxBuilder.build', () => {
    it('returns a valid DOCX Blob from HTML', async () => {
        const html = '<h1>Title</h1><p>Some <strong>bold</strong> content.</p>';
        const blob = await DocxBuilder.build(html, 'MyDoc');
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');

        const zip = await JSZip.loadAsync(blob);
        expect(Object.keys(zip.files)).toContain('word/document.xml');

        const docXml = await zip.file('word/document.xml')!.async('string');
        expect(docXml).toContain('<w:pStyle w:val="Heading1"/>');
        expect(docXml).toContain('<w:b/>');
    });

    it('handles empty HTML', async () => {
        const blob = await DocxBuilder.build('', 'Empty');
        const zip = await JSZip.loadAsync(blob);
        const docXml = await zip.file('word/document.xml')!.async('string');
        // Should have empty body
        expect(docXml).toContain('<w:body>');
    });

    it('handles complex document with multiple element types', async () => {
        const html = `
            <h1>Document Title</h1>
            <p>First paragraph with <strong>bold</strong> and <em>italic</em>.</p>
            <h2>Section One</h2>
            <p>Section content.</p>
            <blockquote><p>A quoted passage.</p></blockquote>
            <ul><li>Bullet one</li><li>Bullet two</li></ul>
            <hr>
            <p>Final paragraph.</p>
        `;
        const blob = await DocxBuilder.build(html, 'Complex');
        const zip = await JSZip.loadAsync(blob);
        const docXml = await zip.file('word/document.xml')!.async('string');

        expect(docXml).toContain('Heading1');
        expect(docXml).toContain('Heading2');
        expect(docXml).toContain('<w:b/>');
        expect(docXml).toContain('<w:i/>');
        expect(docXml).toContain('<w:ind w:left="720"');
        expect(docXml).toContain('<w:numId w:val="1"/>');
        expect(docXml).toContain('<w:pBdr>');
    });
});
