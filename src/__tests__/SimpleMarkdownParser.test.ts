import { describe, it, expect } from 'vitest';
import { SimpleMarkdownParser } from '../modules/SimpleMarkdownParser';

// ─── isMarkdown ───────────────────────────────────────────────────────────

describe('SimpleMarkdownParser.isMarkdown', () => {
    it('returns false for plain text', () => {
        expect(SimpleMarkdownParser.isMarkdown('Hello World')).toBe(false);
        expect(SimpleMarkdownParser.isMarkdown('This is a simple sentence.')).toBe(false);
    });

    it('returns false for plain prose paragraphs', () => {
        const prose = 'The quick brown fox jumped over the lazy dog. It was a dark and stormy night.';
        expect(SimpleMarkdownParser.isMarkdown(prose)).toBe(false);
    });

    it('returns false for text with dashes (not a horizontal rule trigger)', () => {
        expect(SimpleMarkdownParser.isMarkdown('A sentence -- with dashes -- in prose.')).toBe(false);
    });

    it('returns false for raw URL (autolink)', () => {
        expect(SimpleMarkdownParser.isMarkdown('Check out https://example.com for more info.')).toBe(false);
    });

    it('returns false for indented text (not fenced code)', () => {
        expect(SimpleMarkdownParser.isMarkdown('    This is indented text.')).toBe(false);
    });

    it('detects headings', () => {
        expect(SimpleMarkdownParser.isMarkdown('# Heading')).toBe(true);
        expect(SimpleMarkdownParser.isMarkdown('## Subheading')).toBe(true);
    });

    it('detects bold text', () => {
        expect(SimpleMarkdownParser.isMarkdown('This is **bold** text.')).toBe(true);
        expect(SimpleMarkdownParser.isMarkdown('This is __bold__ text.')).toBe(true);
    });

    it('detects italic text', () => {
        expect(SimpleMarkdownParser.isMarkdown('This is *italic* text.')).toBe(true);
        expect(SimpleMarkdownParser.isMarkdown('This is _italic_ text.')).toBe(true);
    });

    it('detects unordered lists', () => {
        expect(SimpleMarkdownParser.isMarkdown('- Item 1\n- Item 2')).toBe(true);
    });

    it('detects ordered lists', () => {
        expect(SimpleMarkdownParser.isMarkdown('1. First\n2. Second')).toBe(true);
    });

    it('detects blockquotes', () => {
        expect(SimpleMarkdownParser.isMarkdown('> This is a quote')).toBe(true);
    });

    it('detects fenced code blocks', () => {
        expect(SimpleMarkdownParser.isMarkdown('```\ncode block\n```')).toBe(true);
        expect(SimpleMarkdownParser.isMarkdown('~~~\ncode block\n~~~')).toBe(true);
    });

    it('detects bracketed links', () => {
        expect(SimpleMarkdownParser.isMarkdown('[Click here](https://example.com)')).toBe(true);
    });

    it('detects strikethrough', () => {
        expect(SimpleMarkdownParser.isMarkdown('This is ~~strikethrough~~ text.')).toBe(true);
    });

    it('detects inline code', () => {
        expect(SimpleMarkdownParser.isMarkdown('Use the `code` function.')).toBe(true);
    });

    it('detects mixed markdown in prose', () => {
        const mixed = `# Chapter 1

It was a **dark** and *stormy* night. The rain fell in torrents.

> "We must go back," she said.

- Item one
- Item two

[More info](https://example.com)`;
        expect(SimpleMarkdownParser.isMarkdown(mixed)).toBe(true);
    });
});

// ─── parse ────────────────────────────────────────────────────────────────

describe('SimpleMarkdownParser.parse', () => {
    it('converts headings to HTML', () => {
        const result = SimpleMarkdownParser.parse('# Hello');
        expect(result).toContain('<h1');
        expect(result).toContain('Hello');
    });

    it('converts bold to HTML', () => {
        const result = SimpleMarkdownParser.parse('**bold**');
        expect(result).toContain('<strong>bold</strong>');
    });

    it('converts italic to HTML', () => {
        const result = SimpleMarkdownParser.parse('*italic*');
        expect(result).toContain('<em>italic</em>');
    });

    it('converts links to HTML', () => {
        const result = SimpleMarkdownParser.parse('[link](https://example.com)');
        expect(result).toContain('<a href="https://example.com">link</a>');
    });

    it('converts line breaks to <br> (GFM breaks mode)', () => {
        const result = SimpleMarkdownParser.parse('Line 1\nLine 2');
        expect(result).toContain('<br');
    });

    it('handles empty string', () => {
        const result = SimpleMarkdownParser.parse('');
        expect(result).toBe('');
    });

    it('converts code blocks', () => {
        const result = SimpleMarkdownParser.parse('```\nconst x = 1;\n```');
        expect(result).toContain('<code>');
    });

    it('handles plain text passthrough', () => {
        const result = SimpleMarkdownParser.parse('Hello World');
        expect(result).toContain('Hello World');
    });
});
