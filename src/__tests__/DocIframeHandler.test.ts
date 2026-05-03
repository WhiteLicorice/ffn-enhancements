import { describe, it, expect } from 'vitest';
import { DocIframeHandler } from '../modules/DocIframeHandler';

// ─── _isHtmlSource ──────────────────────────────────────────────────────────

describe('_isHtmlSource', () => {

    // ── unambiguous signals ──

    it('detects DOCTYPE declaration', () => {
        expect(DocIframeHandler._isHtmlSource('<!DOCTYPE html>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<!DOCTYPE html>\n<html><body></body></html>')).toBe(true);
    });

    it('detects HTML comments', () => {
        expect(DocIframeHandler._isHtmlSource('<!-- main content -->')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<p>Hello<!-- comment --></p>')).toBe(true);
    });

    // ── opening tags ──

    it('detects <html> tag', () => {
        expect(DocIframeHandler._isHtmlSource('<html lang="en">')).toBe(true);
    });

    it('detects <head> and <body> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<head><title>Test</title></head>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<body class="dark">')).toBe(true);
    });

    it('detects <div> and <span> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<div>content</div>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<span class="hl">text</span>')).toBe(true);
    });

    it('detects <a> and <img> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<a href="https://example.com">link</a>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<img src="pic.png" alt="Photo">')).toBe(true);
    });

    it('detects <strong>, <em>, <b>, <i>, <u>, <s> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<strong>bold</strong>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<em>italic</em>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<b>bold</b>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<i>italic</i>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<u>underline</u>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<s>strike</s>')).toBe(true);
    });

    it('detects <br> and <hr> self-closing tags', () => {
        expect(DocIframeHandler._isHtmlSource('<br>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<br/>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<br />')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<hr>')).toBe(true);
    });

    it('detects <table>, <tr>, <td>, <th> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<table><tr><td>cell</td></tr></table>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<th>header</th>')).toBe(true);
    });

    it('detects <pre> and <code> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<pre>code block</pre>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<code>var x = 1;</code>')).toBe(true);
    });

    it('detects <form>, <input>, <button>, <textarea> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<form action="/submit">')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<input type="text" name="q">')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<button type="submit">Go</button>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<textarea rows="5"></textarea>')).toBe(true);
    });

    it('detects <script> and <style> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<script src="app.js"></script>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<style>.cls { color: red; }</style>')).toBe(true);
    });

    it('detects <meta> and <link> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<meta charset="utf-8">')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<link rel="stylesheet" href="style.css">')).toBe(true);
    });

    it('detects <header>, <footer>, <nav>, <main>, <aside> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<header>Header</header>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<nav><a href="/">Home</a></nav>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<main>content</main>')).toBe(true);
    });

    it('detects <section> and <article> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<section>section</section>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<article>article</article>')).toBe(true);
    });

    it('detects <p>, <h1>-<h6>, <ul>, <ol>, <li> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<p>paragraph</p>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<h1>Title</h1>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<h6>Subtitle</h6>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<ul><li>item</li></ul>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<ol><li>item</li></ol>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<li>item</li>')).toBe(true);
    });

    it('detects <blockquote> and <figure> tags', () => {
        expect(DocIframeHandler._isHtmlSource('<blockquote>quote</blockquote>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<figure><img src="x.png"></figure>')).toBe(true);
    });

    // ── closing tags ──

    it('detects closing tags alone', () => {
        // Closing </div> should match on the closing-tag alternation.
        expect(DocIframeHandler._isHtmlSource('</div>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('</p>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('</span>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('</body>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('</html>')).toBe(true);
    });

    // ── fragments (realistic snippets) ──

    it('detects realistic HTML fragments', () => {
        expect(DocIframeHandler._isHtmlSource('<a href="https://example.com">Click here</a>')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<img src="https://example.com/image.jpg" />')).toBe(true);
        expect(DocIframeHandler._isHtmlSource('<br /><br />')).toBe(true);
    });

    it('detects full HTML document structure', () => {
        const doc = '<!DOCTYPE html>\n<html lang="en">\n<head><title>Test</title></head>\n<body><p>Hello</p></body>\n</html>';
        expect(DocIframeHandler._isHtmlSource(doc)).toBe(true);
    });

    // ── non-HTML (should NOT match) ──

    it('rejects plain text without angle brackets', () => {
        expect(DocIframeHandler._isHtmlSource('Just some plain text')).toBe(false);
    });

    it('rejects TypeScript generics', () => {
        expect(DocIframeHandler._isHtmlSource('Array<string>')).toBe(false);
        expect(DocIframeHandler._isHtmlSource('const x: Record<string, number> = {};')).toBe(false);
    });

    it('rejects markdown with angle brackets', () => {
        expect(DocIframeHandler._isHtmlSource('Use the `<T>` generic')).toBe(false);
    });

    it('rejects mathematical expressions', () => {
        expect(DocIframeHandler._isHtmlSource('1 < 2 && 3 > 2')).toBe(false);
        expect(DocIframeHandler._isHtmlSource('x > y')).toBe(false);
    });

    it('rejects XML fragments without known HTML tags', () => {
        expect(DocIframeHandler._isHtmlSource('<root><item id="1">val</item></root>')).toBe(false);
        expect(DocIframeHandler._isHtmlSource('<rss version="2.0"><channel><entry>Feed</entry></channel></rss>')).toBe(false);
    });

    it('handles empty string', () => {
        expect(DocIframeHandler._isHtmlSource('')).toBe(false);
    });

    it('handles whitespace-only string', () => {
        expect(DocIframeHandler._isHtmlSource('   ')).toBe(false);
    });
});
