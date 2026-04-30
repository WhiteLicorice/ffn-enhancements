import { describe, it, expect } from 'vitest';
import { EpubBuilder } from '../modules/EpubBuilder';
import { StoryMetadata } from '../interfaces/StoryMetadata';
import { ChapterData } from '../interfaces/ChapterData';

function meta(overrides: Partial<StoryMetadata> = {}): StoryMetadata {
    return {
        id: '12345',
        title: 'Test Story',
        author: 'TestAuthor',
        authorUrl: '',
        storyUrl: '',
        source: 'FanFiction.net',
        description: 'A test story description.',
        genre: 'Fantasy',
        language: 'English',
        rating: 'T',
        status: 'Complete',
        words: '50000',
        published: '2020-01-01',
        updated: '2021-06-15',
        characters: 'Alice, Bob',
        reviews: '42',
        favs: '100',
        follows: '80',
        ...overrides,
    };
}

function chap(n: number, overrides: Partial<ChapterData> = {}): ChapterData {
    return { number: n, title: `Chapter ${n}`, content: `<p>Content of chapter ${n}.</p>`, ...overrides };
}

function chapters(count: number): ChapterData[] {
    return Array.from({ length: count }, (_, i) => chap(i + 1));
}

// ─── escape ───────────────────────────────────────────────────────────────

describe('EpubBuilder.escape', () => {
    it('returns empty string for undefined', () => {
        expect(EpubBuilder.escape(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(EpubBuilder.escape('')).toBe('');
    });

    it('returns unchanged string with no special chars', () => {
        expect(EpubBuilder.escape('Hello World')).toBe('Hello World');
    });

    it('escapes &', () => {
        expect(EpubBuilder.escape('A & B')).toBe('A &amp; B');
    });

    it('escapes <', () => {
        expect(EpubBuilder.escape('a < b')).toBe('a &lt; b');
    });

    it('escapes >', () => {
        expect(EpubBuilder.escape('a > b')).toBe('a &gt; b');
    });

    it('escapes "', () => {
        expect(EpubBuilder.escape('He said "hello"')).toBe('He said &quot;hello&quot;');
    });

    it('escapes & before other characters so &amp; is not double-unescaped mid-stream', () => {
        expect(EpubBuilder.escape('& < >')).toBe('&amp; &lt; &gt;');
    });

    it('handles already-escaped entities by double-escaping the &', () => {
        expect(EpubBuilder.escape('&amp;')).toBe('&amp;amp;');
    });

    it('handles mixed content', () => {
        expect(EpubBuilder.escape('<script>alert("XSS & Co")</script>'))
            .toBe('&lt;script&gt;alert(&quot;XSS &amp; Co&quot;)&lt;/script&gt;');
    });
});

// ─── generateCoverPage ────────────────────────────────────────────────────

describe('EpubBuilder.generateCoverPage', () => {
    it('uses jpg extension by default', () => {
        const result = EpubBuilder.generateCoverPage();
        expect(result).toContain('xlink:href="cover.jpg"');
    });

    it('uses png extension when specified', () => {
        const result = EpubBuilder.generateCoverPage('png');
        expect(result).toContain('xlink:href="cover.png"');
    });

    it('produces valid XML with svg wrapper', () => {
        const result = EpubBuilder.generateCoverPage();
        expect(result).toContain('<?xml version="1.0" encoding="utf-8"?>');
        expect(result).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
        expect(result).toContain('viewBox="0 0 600 800"');
    });
});

// ─── generateTOCPage ──────────────────────────────────────────────────────

describe('EpubBuilder.generateTOCPage', () => {
    it('renders empty list for zero chapters', () => {
        const result = EpubBuilder.generateTOCPage(meta(), []);
        expect(result).toContain('<ul class="toc">');
        expect(result).not.toContain('<li>');
    });

    it('renders a single chapter link', () => {
        const result = EpubBuilder.generateTOCPage(meta(), [chap(1)]);
        expect(result).toContain('<li><a href="chapter_1.xhtml">Chapter 1</a></li>');
    });

    it('renders multiple chapter links', () => {
        const result = EpubBuilder.generateTOCPage(meta(), chapters(3));
        expect(result).toContain('chapter_1.xhtml');
        expect(result).toContain('chapter_2.xhtml');
        expect(result).toContain('chapter_3.xhtml');
    });

    it('escapes chapter titles with special chars', () => {
        const result = EpubBuilder.generateTOCPage(meta(), [chap(1, { title: 'Intro "Quotes" & <Brackets>' })]);
        expect(result).toContain('&quot;Quotes&quot; &amp; &lt;Brackets&gt;');
    });

    it('produces valid XHTML structure', () => {
        const result = EpubBuilder.generateTOCPage(meta(), chapters(1));
        expect(result).toContain('<?xml version="1.0" encoding="utf-8"?>');
        expect(result).toContain('<!DOCTYPE html PUBLIC');
        expect(result).toContain('<html xmlns="http://www.w3.org/1999/xhtml">');
    });
});

// ─── generateNCX ──────────────────────────────────────────────────────────

describe('EpubBuilder.generateNCX', () => {
    it('renders title page and TOC nav points for coverless book', () => {
        const m = meta({ coverBlob: undefined });
        const result = EpubBuilder.generateNCX(m, chapters(2));
        expect(result).not.toContain('navPoint-cover');
        expect(result).toContain('navPoint-title');
        expect(result).toContain('navPoint-toc');
        expect(result).toContain('navPoint-1');
        expect(result).toContain('navPoint-2');
    });

    it('includes cover nav point when cover blob present', () => {
        const m = meta({ coverBlob: new Blob(['fake'], { type: 'image/jpeg' }) });
        const result = EpubBuilder.generateNCX(m, chapters(1));
        expect(result).toContain('navPoint-cover');
        expect(result).toContain('<text>Cover</text>');
    });

    it('uses sequential playOrder starting at 1', () => {
        const result = EpubBuilder.generateNCX(meta(), chapters(2));
        expect(result).toContain('playOrder="1"');
        expect(result).toContain('playOrder="2"');
        expect(result).toContain('playOrder="3"');
        // Title, TOC, ch1, ch2 = 4 nav points
        expect(result).toContain('playOrder="4"');
    });

    it('escapes title and chapter names', () => {
        const m = meta({ title: 'Story "A" & <B>' });
        const result = EpubBuilder.generateNCX(m, [chap(1, { title: 'Ch "One" & <Two>' })]);
        expect(result).toContain('Story &quot;A&quot; &amp; &lt;B&gt;');
        expect(result).toContain('Ch &quot;One&quot; &amp; &lt;Two&gt;');
    });

    it('includes xml declaration and ncx namespace', () => {
        const result = EpubBuilder.generateNCX(meta(), []);
        expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(result).toContain('xmlns="http://www.daisy.org/z3986/2005/ncx/"');
    });
});

// ─── generateXHTML ────────────────────────────────────────────────────────

describe('EpubBuilder.generateXHTML', () => {
    it('wraps content in valid XHTML document', () => {
        const result = EpubBuilder.generateXHTML('Chapter 1', '<p>Hello World</p>');
        expect(result).toContain('<?xml version="1.0" encoding="utf-8"?>');
        expect(result).toContain('<h2>Chapter 1</h2>');
        expect(result).toMatch(/<p[^>]*>Hello World<\/p>/);
    });

    it('escapes title special chars', () => {
        const result = EpubBuilder.generateXHTML('Ch "1" & <More>', '<p>body</p>');
        expect(result).toContain('Ch &quot;1&quot; &amp; &lt;More&gt;');
    });

    it('converts HTML <br> to XHTML <br/> via makeValidXHTML', () => {
        const result = EpubBuilder.generateXHTML('Ch1', '<p>Line 1<br>Line 2</p>');
        expect(result).toMatch(/<br[^>]*\/>/);
    });
});

// ─── generateTitlePage ────────────────────────────────────────────────────

describe('EpubBuilder.generateTitlePage', () => {
    it('includes title and author', () => {
        const result = EpubBuilder.generateTitlePage(meta(), 5);
        expect(result).toContain('<h1>Test Story</h1>');
        expect(result).toContain('TestAuthor');
    });

    it('excludes cover image when no cover blob', () => {
        const m = meta({ coverBlob: undefined });
        const result = EpubBuilder.generateTitlePage(m, 5);
        expect(result).not.toContain('cover-img');
    });

    it('includes cover image when cover blob present', () => {
        const m = meta({ coverBlob: new Blob(['fake'], { type: 'image/jpeg' }) });
        const result = EpubBuilder.generateTitlePage(m, 5);
        expect(result).toContain('cover-img');
        expect(result).toContain('cover.jpg');
    });

    it('uses png extension for png cover', () => {
        const m = meta({ coverBlob: new Blob(['fake'], { type: 'image/png' }) });
        const result = EpubBuilder.generateTitlePage(m, 5);
        expect(result).toContain('cover.png');
    });

    it('renders author as link when authorUrl present', () => {
        const m = meta({ authorUrl: 'https://example.com/author' });
        const result = EpubBuilder.generateTitlePage(m, 5);
        expect(result).toContain('<a href="https://example.com/author">TestAuthor</a>');
    });

    it('renders source as link when storyUrl present', () => {
        const m = meta({ storyUrl: 'https://example.com/story' });
        const result = EpubBuilder.generateTitlePage(m, 5);
        expect(result).toContain('<a href="https://example.com/story">FanFiction.net</a>');
    });

    it('includes metadata rows for non-empty values', () => {
        const result = EpubBuilder.generateTitlePage(meta(), 10);
        expect(result).toContain('Chapters');
        expect(result).toMatch(/>\s*10\s*</); // chapterCount displayed
        expect(result).toContain('Words');
        expect(result).toMatch(/>\s*50000\s*</);
    });

    it('omits metadata rows for undefined values', () => {
        const m = meta({ rating: undefined, genre: undefined, words: undefined });
        const result = EpubBuilder.generateTitlePage(m, 5);
        expect(result).not.toContain('Rated');
        expect(result).not.toContain('Genre');
    });
});

// ─── generateOPF ──────────────────────────────────────────────────────────

describe('EpubBuilder.generateOPF', () => {
    it('produces valid OPF with package element', () => {
        const result = EpubBuilder.generateOPF(meta(), chapters(1), 'image/jpeg');
        expect(result).toContain('<?xml version="1.0" encoding="utf-8"?>');
    });

    it('includes Dublin Core metadata', () => {
        const result = EpubBuilder.generateOPF(meta(), chapters(1), 'image/jpeg');
        expect(result).toContain('dc:title');
        expect(result).toContain('Test Story');
        expect(result).toContain('dc:creator');
        expect(result).toContain('TestAuthor');
    });

    it('defaults language to en when missing', () => {
        const m = meta({ language: undefined });
        const result = EpubBuilder.generateOPF(m, chapters(1), 'image/jpeg');
        expect(result).toContain('en');
    });

    it('uses first two chars of language code', () => {
        const m = meta({ language: 'English' });
        const result = EpubBuilder.generateOPF(m, chapters(1), 'image/jpeg');
        expect(result).toMatch(/>en</i); // "English".slice(0,2).toLowerCase() = "en"
    });

    it('excludes cover items when no cover blob', () => {
        const m = meta({ coverBlob: undefined });
        const result = EpubBuilder.generateOPF(m, chapters(1), 'image/jpeg');
        expect(result).not.toContain('name="cover"');
        expect(result).not.toContain('id="cover"');
        expect(result).not.toContain('cover-page');
    });

    it('includes cover metadata, manifest item, spine ref, and guide ref when cover present', () => {
        const m = meta({ coverBlob: new Blob(['fake'], { type: 'image/jpeg' }) });
        const result = EpubBuilder.generateOPF(m, chapters(1), 'image/jpeg');
        expect(result).toContain('name="cover"');
        expect(result).toContain('id="cover"');
        expect(result).toContain('id="cover-page"');
        expect(result).toContain('idref="cover-page"');
        expect(result).toContain('type="cover"');
    });

    it('generates manifest items for each chapter', () => {
        const result = EpubBuilder.generateOPF(meta(), chapters(3), 'image/jpeg');
        expect(result).toContain('id="chap1"');
        expect(result).toContain('id="chap2"');
        expect(result).toContain('id="chap3"');
    });

    it('generates spine refs for each chapter', () => {
        const result = EpubBuilder.generateOPF(meta(), chapters(2), 'image/jpeg');
        expect(result).toContain('idref="chap1"');
        expect(result).toContain('idref="chap2"');
    });
});

// ─── makeValidXHTML ───────────────────────────────────────────────────────

describe('EpubBuilder.makeValidXHTML', () => {
    it('converts <br> to self-closing', () => {
        const result = EpubBuilder.makeValidXHTML('Hello<br>World');
        expect(result).toMatch(/<br[^>]*\/>/);
    });

    it('converts <hr> to self-closing', () => {
        const result = EpubBuilder.makeValidXHTML('<hr>');
        expect(result).toMatch(/<hr[^>]*\/>/);
    });

    it('converts <img src="x"> to self-closing', () => {
        const result = EpubBuilder.makeValidXHTML('<img src="test.png">');
        expect(result).toContain('/>');
    });

    it('preserves text content', () => {
        const result = EpubBuilder.makeValidXHTML('<p>Hello World</p>');
        expect(result).toContain('Hello World');
    });

    it('handles mixed HTML', () => {
        const result = EpubBuilder.makeValidXHTML('<p>Line 1<br>Line 2</p><hr><p>More</p>');
        expect(result).toMatch(/<br[^>]*\/>/);
        expect(result).toMatch(/<hr[^>]*\/>/);
        expect(result).toContain('Line 1');
        expect(result).toContain('Line 2');
    });
});
