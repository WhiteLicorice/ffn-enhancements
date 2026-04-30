// modules/DocxBuilder.ts

import { Core } from './Core';
import JSZip from 'jszip';

// ─── Intermediate Representation Types ─────────────────────────────────────

interface OoxmlRun {
    text?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    lineBreak?: boolean;
}

interface OoxmlHyperlink {
    rId: string;
    url: string;
    runs: OoxmlRun[];
}

type OoxmlParagraphChild = OoxmlRun | OoxmlHyperlink;

interface OoxmlParagraph {
    children: OoxmlParagraphChild[];
    style?: 'Heading1' | 'Heading2' | 'Heading3';
    indentation?: { left: number; right: number };
    numbering?: { id: number; level: number };
    alignment?: 'left' | 'center' | 'right';
    isPageBreak?: boolean;
}

interface ParseResult {
    paragraphs: OoxmlParagraph[];
    hyperlinks: Map<string, string>; // rId → url
}

// ─── Module ─────────────────────────────────────────────────────────────────

/**
 * Converts HTML content to a .docx Blob (Office Open XML format).
 *
 * The conversion pipeline:
 *   HTML string → DOMParser → recursive DOM walk → OoxmlParagraph[]
 *   → _generateDocumentXml() → OOXML string → JSZip → Blob
 *
 * Only the subset of HTML produced by FFN's TinyMCE editor is supported:
 * paragraphs, headings (h1–h3), bold/italic/underline/strikethrough,
 * links, bulleted/numbered lists, blockquotes, and horizontal rules.
 */
export const DocxBuilder = {
    MODULE_NAME: 'DocxBuilder',

    /**
     * Converts HTML content to a .docx Blob ready for download.
     * @param html - Raw HTML from the editor textarea.
     * @param title - Document title, embedded in DOCX core properties.
     * @returns A Blob with the DOCX MIME type.
     */
    build: async function (html: string, title: string): Promise<Blob> {
        const log = Core.getLogger(this.MODULE_NAME, 'build');
        log(`Building DOCX for "${title}"`);

        const { paragraphs, hyperlinks } = this._parseHtmlToParagraphs(html);
        return this._buildZip(paragraphs, title, hyperlinks);
    },

    // ─── Parsing ────────────────────────────────────────────────────────

    /**
     * Parses an HTML string into an array of OOXML paragraph descriptors.
     * Uses DOMParser to build a DOM tree, then walks block-level children.
     */
    _parseHtmlToParagraphs: function (html: string): ParseResult {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html || '', 'text/html');
        const paragraphs: OoxmlParagraph[] = [];
        const hyperlinks = new Map<string, string>();
        let nextRId = 1;

        const assignRId = (url: string): string => {
            let rId = '';
            for (const [k, v] of hyperlinks) {
                if (v === url) { rId = k; break; }
            }
            if (!rId) {
                rId = `rId${nextRId++}`;
                hyperlinks.set(rId, url);
            }
            return rId;
        };

        const ctx = { hyperlinks, nextRId, assignRId };

        for (const node of Array.from(doc.body.childNodes)) {
            walkBlockNode(node, paragraphs, {}, 0, ctx);
        }

        return { paragraphs, hyperlinks };
    },

    /**
     * Recursively converts an HTML node tree into OOXML paragraphs (block-level
     * walk). Text nodes at this level create a paragraph if non-whitespace.
     */
    _convertNode: function (node: Node, runs: OoxmlRun[]): OoxmlRun[] {
        walkInlineChildren(node, runs, {});
        return runs;
    },

    // ─── XML Generation ──────────────────────────────────────────────────

    /**
     * Generates the main word/document.xml content from parsed paragraphs.
     */
    _generateDocumentXml: function (paragraphs: OoxmlParagraph[], hyperlinks: Map<string, string>): string {
        const bodyXML = paragraphs.map(p => renderParagraph(p)).join('\n');
        const hasLinks = hyperlinks.size > 0;
        const rNs = hasLinks ? '\n            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' : '';

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"${rNs}>
  <w:body>
${bodyXML}
  </w:body>
</w:document>`;
    },

    // ─── ZIP Assembly ────────────────────────────────────────────────────

    /**
     * Packages all DOCX components into a ZIP Blob.
     */
    _buildZip: async function (paragraphs: OoxmlParagraph[], _title: string, hyperlinks: Map<string, string>): Promise<Blob> {
        const zip = new JSZip();

        zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
        zip.file('_rels/.rels', RELS_XML);
        zip.file('word/styles.xml', STYLES_XML);
        zip.file('word/numbering.xml', NUMBERING_XML);
        zip.file('word/document.xml', this._generateDocumentXml(paragraphs, hyperlinks));

        if (hyperlinks.size > 0) {
            zip.file('word/_rels/document.xml.rels', generateDocumentRels(hyperlinks));
        }

        return zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
    },
};

// ─── Block-level Node Walker ─────────────────────────────────────────────────

function walkBlockNode(
    node: Node,
    paragraphs: OoxmlParagraph[],
    inherited: OoxmlRun,
    blockIndent: number,
    ctx: { hyperlinks: Map<string, string>; assignRId: (url: string) => string },
): void {
    if (node.nodeType === Node.COMMENT_NODE) return;

    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text.trim()) {
            paragraphs.push({ children: [{ ...inherited, text }] });
        }
        return;
    }

    if (!(node instanceof HTMLElement)) return;

    const tag = node.nodeName.toUpperCase();

    switch (tag) {
        case 'P':
        case 'DIV': {
            const children: OoxmlParagraphChild[] = [];
            walkInlineChildren(node, children, inherited, ctx);
            if (children.length > 0 || node.querySelector('br')) {
                const para: OoxmlParagraph = { children };
                if (blockIndent > 0) para.indentation = { left: 720 * blockIndent, right: 720 * blockIndent };
                if (tag === 'DIV') applyDivAlignment(node, para);
                paragraphs.push(para);
            }
            break;
        }
        case 'H1':
            extractHeading(node, paragraphs, 'Heading1', inherited, blockIndent, ctx);
            break;
        case 'H2':
            extractHeading(node, paragraphs, 'Heading2', inherited, blockIndent, ctx);
            break;
        case 'H3':
            extractHeading(node, paragraphs, 'Heading3', inherited, blockIndent, ctx);
            break;
        case 'H4':
        case 'H5':
        case 'H6': {
            const children: OoxmlParagraphChild[] = [];
            walkInlineChildren(node, children, { ...inherited, bold: true }, ctx);
            const para: OoxmlParagraph = { children };
            if (blockIndent > 0) para.indentation = { left: 720 * blockIndent, right: 720 * blockIndent };
            paragraphs.push(para);
            break;
        }
        case 'UL':
            walkList(node, paragraphs, 1, 0, ctx);
            break;
        case 'OL':
            walkList(node, paragraphs, 2, 0, ctx);
            break;
        case 'BLOCKQUOTE':
            for (const child of Array.from(node.childNodes)) {
                walkBlockNode(child, paragraphs, inherited, blockIndent + 1, ctx);
            }
            break;
        case 'HR':
            paragraphs.push({ children: [{ text: '' }], isPageBreak: true });
            break;
        case 'PRE':
        case 'CODE': {
            const text = node.textContent || '';
            const children: OoxmlParagraphChild[] = [{ text }];
            const para: OoxmlParagraph = { children };
            if (blockIndent > 0) para.indentation = { left: 720 * blockIndent, right: 720 * blockIndent };
            paragraphs.push(para);
            break;
        }
        case 'BR': {
            paragraphs.push({ children: [{ text: '', lineBreak: true }] });
            break;
        }
        default: {
            // Unknown element: recurse into children as if they were block-level
            for (const child of Array.from(node.childNodes)) {
                walkBlockNode(child, paragraphs, inherited, blockIndent, ctx);
            }
            break;
        }
    }
}

function extractHeading(
    node: HTMLElement,
    paragraphs: OoxmlParagraph[],
    style: 'Heading1' | 'Heading2' | 'Heading3',
    inherited: OoxmlRun,
    blockIndent: number,
    ctx: { hyperlinks: Map<string, string>; assignRId: (url: string) => string },
): void {
    const children: OoxmlParagraphChild[] = [];
    walkInlineChildren(node, children, inherited, ctx);
    const para: OoxmlParagraph = { children, style };
    if (blockIndent > 0) para.indentation = { left: 720 * blockIndent, right: 720 * blockIndent };
    paragraphs.push(para);
}

function applyDivAlignment(node: HTMLElement, para: OoxmlParagraph): void {
    const style = (node.getAttribute('style') || '').toLowerCase();
    if (style.includes('text-align: center') || style.includes('text-align:center')) {
        para.alignment = 'center';
    } else if (style.includes('text-align: right') || style.includes('text-align:right')) {
        para.alignment = 'right';
    }
}

// ─── Inline Node Walker ──────────────────────────────────────────────────────

function walkInlineChildren(
    container: Node,
    children: OoxmlParagraphChild[],
    inherited: OoxmlRun,
    ctx?: { hyperlinks: Map<string, string>; assignRId: (url: string) => string },
    skipTags?: Set<string>,
): void {
    // Handle text node passed as container (e.g., from walkList LI processing)
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || '';
        if (text) {
            children.push({ ...inherited, text });
        }
        return;
    }

    for (const node of Array.from(container.childNodes)) {
        if (node.nodeType === Node.COMMENT_NODE) continue;

        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            if (text) {
                children.push({ ...inherited, text });
            }
            continue;
        }

        if (!(node instanceof HTMLElement)) continue;

        const tag = node.nodeName.toUpperCase();
        if (skipTags?.has(tag)) continue;

        const fmt = { ...inherited };

        switch (tag) {
            case 'STRONG':
            case 'B':
                fmt.bold = true;
                walkInlineChildren(node, children, fmt, ctx);
                break;
            case 'EM':
            case 'I':
                fmt.italic = true;
                walkInlineChildren(node, children, fmt, ctx);
                break;
            case 'U':
            case 'INS':
                fmt.underline = true;
                walkInlineChildren(node, children, fmt, ctx);
                break;
            case 'S':
            case 'STRIKE':
            case 'DEL':
                fmt.strikethrough = true;
                walkInlineChildren(node, children, fmt, ctx);
                break;
            case 'A': {
                const url = node.getAttribute('href') || '';
                if (url && ctx) {
                    const rId = ctx.assignRId(url);
                    const linkRuns: OoxmlRun[] = [];
                    walkInlineChildren(node, linkRuns, fmt, ctx);
                    // Only recurse for text nodes; nested blocks inside <a> are unusual
                    if (linkRuns.length > 0) {
                        children.push({ rId, url, runs: linkRuns });
                    }
                } else {
                    walkInlineChildren(node, children, fmt, ctx);
                }
                break;
            }
            case 'BR':
                children.push({ text: '', ...fmt, lineBreak: true });
                break;
            case 'IMG': {
                const alt = node.getAttribute('alt') || '[Image]';
                children.push({ text: alt, ...fmt });
                break;
            }
            case 'SPAN': {
                applySpanFormatting(node, fmt);
                walkInlineChildren(node, children, fmt, ctx);
                break;
            }
            case 'SUB':
            case 'SUP':
            case 'MARK':
            case 'ABBR':
            case 'CITE':
            case 'CODE':
            case 'KBD':
            case 'SAMP':
            case 'VAR':
            case 'LABEL':
            case 'SMALL':
            case 'BIG':
                walkInlineChildren(node, children, fmt, ctx);
                break;
            default: {
                // Unknown inline element — recurse but don't apply formatting
                walkInlineChildren(node, children, fmt, ctx);
                break;
            }
        }
    }
}

function applySpanFormatting(node: HTMLElement, fmt: OoxmlRun): void {
    const style = (node.getAttribute('style') || '').toLowerCase();
    if (!style) return;
    if (style.includes('font-weight: bold') || style.includes('font-weight:bold')) fmt.bold = true;
    if (style.includes('font-style: italic') || style.includes('font-style:italic')) fmt.italic = true;
    if (style.includes('text-decoration: underline') || style.includes('text-decoration:underline')) fmt.underline = true;
    if (style.includes('text-decoration: line-through') || style.includes('text-decoration:line-through')) fmt.strikethrough = true;
}

// ─── List Walker ─────────────────────────────────────────────────────────────

function walkList(
    node: HTMLElement,
    paragraphs: OoxmlParagraph[],
    numId: number,
    level: number,
    ctx: { hyperlinks: Map<string, string>; assignRId: (url: string) => string },
): void {
    for (const child of Array.from(node.childNodes)) {
        if (!(child instanceof HTMLElement) || child.nodeName.toUpperCase() !== 'LI') continue;

        const children: OoxmlParagraphChild[] = [];
        const nestedLists: HTMLElement[] = [];

        walkInlineChildren(child, children, {}, ctx, new Set(['UL', 'OL']));

        for (const liChild of Array.from(child.childNodes)) {
            if (liChild instanceof HTMLElement) {
                const t = liChild.nodeName.toUpperCase();
                if (t === 'UL' || t === 'OL') {
                    nestedLists.push(liChild);
                }
            }
        }

        if (children.length > 0) {
            paragraphs.push({ children, numbering: { id: numId, level } });
        }

        for (const nested of nestedLists) {
            const nestedType = nested.nodeName.toUpperCase();
            walkList(nested, paragraphs, nestedType === 'UL' ? 1 : 2, level + 1, ctx);
        }
    }
}

// ─── OOXML Renderers ─────────────────────────────────────────────────────────

function renderParagraph(para: OoxmlParagraph): string {
    const pPrParts: string[] = [];

    if (para.style) {
        pPrParts.push(`    <w:pStyle w:val="${para.style}"/>`);
    }
    if (para.numbering) {
        pPrParts.push('    <w:numPr>',
            `      <w:ilvl w:val="${para.numbering.level}"/>`,
            `      <w:numId w:val="${para.numbering.id}"/>`,
            '    </w:numPr>');
    }
    if (para.indentation) {
        pPrParts.push(`    <w:ind w:left="${para.indentation.left}" w:right="${para.indentation.right}"/>`);
    }
    if (para.alignment) {
        const jc = para.alignment === 'center' ? 'center' : para.alignment === 'right' ? 'right' : 'left';
        if (jc !== 'left') {
            pPrParts.push(`    <w:jc w:val="${jc}"/>`);
        }
    }
    if (para.isPageBreak) {
        pPrParts.push('    <w:pBdr>',
            '      <w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/>',
            '    </w:pBdr>');
    }

    const pPr = pPrParts.length > 0
        ? '\n  <w:pPr>\n' + pPrParts.join('\n') + '\n  </w:pPr>\n'
        : '';

    const childrenXML = para.children.map(c => renderChild(c)).join('\n');

    return `  <w:p>${pPr}${childrenXML}\n  </w:p>`;
}

function renderChild(child: OoxmlParagraphChild): string {
    if ('rId' in child) {
        return renderHyperlink(child);
    }
    return renderRun(child);
}

function renderRun(run: OoxmlRun): string {
    const rPrParts: string[] = [];
    if (run.bold) rPrParts.push('<w:b/>');
    if (run.italic) rPrParts.push('<w:i/>');
    if (run.underline) rPrParts.push('<w:u w:val="single"/>');
    if (run.strikethrough) rPrParts.push('<w:strike/>');

    if (run.lineBreak) {
        const rPr = rPrParts.length > 0
            ? '\n      <w:rPr>' + rPrParts.join('') + '</w:rPr>'
            : '';
        return `    <w:r>${rPr}\n      <w:br/>\n    </w:r>`;
    }

    const escaped = escapeXmlText(run.text ?? '');
    if (rPrParts.length > 0) {
        return `    <w:r>\n      <w:rPr>${rPrParts.join('')}</w:rPr>\n      <w:t xml:space="preserve">${escaped}</w:t>\n    </w:r>`;
    }
    return `    <w:r>\n      <w:t xml:space="preserve">${escaped}</w:t>\n    </w:r>`;
}

function renderHyperlink(hl: OoxmlHyperlink): string {
    const runsXML = hl.runs.map(r => {
        const rPrParts: string[] = ['<w:rStyle w:val="Hyperlink"/>'];
        if (r.bold) rPrParts.push('<w:b/>');
        if (r.italic) rPrParts.push('<w:i/>');
        if (r.underline) rPrParts.push('<w:u w:val="single"/>');
        if (r.strikethrough) rPrParts.push('<w:strike/>');

        const escaped = escapeXmlText(r.text ?? '');
        return `      <w:r>\n        <w:rPr>${rPrParts.join('')}</w:rPr>\n        <w:t xml:space="preserve">${escaped}</w:t>\n      </w:r>`;
    }).join('\n');

    return `    <w:hyperlink r:id="${hl.rId}">\n${runsXML}\n    </w:hyperlink>`;
}

// ─── Static XML Templates ────────────────────────────────────────────────────

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="true">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="360" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:b/>
      <w:sz w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="240" w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:b/>
      <w:sz w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="200" w:after="60"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:b/>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr>
      <w:color w:val="0563C1"/>
      <w:u w:val="single"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:nsid w:val="00000001"/>
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:pPr>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
      <w:rPr>
        <w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/>
      </w:rPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="◦"/>
      <w:lvlJc w:val="left"/>
      <w:pPr>
        <w:ind w:left="1440" w:hanging="360"/>
      </w:pPr>
      <w:rPr>
        <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>
      </w:rPr>
    </w:lvl>
    <w:lvl w:ilvl="2">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="▪"/>
      <w:lvlJc w:val="left"/>
      <w:pPr>
        <w:ind w:left="2160" w:hanging="360"/>
      </w:pPr>
      <w:rPr>
        <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>
      </w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
  <w:abstractNum w:abstractNumId="1">
    <w:nsid w:val="00000002"/>
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="lowerLetter"/>
      <w:lvlText w:val="%2."/>
      <w:lvlJc w:val="left"/>
      <w:pPr>
        <w:ind w:left="1440" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
    <w:lvl w:ilvl="2">
      <w:start w:val="1"/>
      <w:numFmt w:val="lowerRoman"/>
      <w:lvlText w:val="%3."/>
      <w:lvlJc w:val="left"/>
      <w:pPr>
        <w:ind w:left="2160" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="2">
    <w:abstractNumId w:val="1"/>
  </w:num>
</w:numbering>`;

function generateDocumentRels(hyperlinks: Map<string, string>): string {
    const entries: string[] = [];
    for (const [rId, url] of hyperlinks) {
        entries.push(`  <Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXmlAttr(url)}" TargetMode="External"/>`);
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${entries.join('\n')}
</Relationships>`;
}

// ─── XML Escaping ────────────────────────────────────────────────────────────

function escapeXmlText(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function escapeXmlAttr(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
