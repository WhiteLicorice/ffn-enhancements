import { parseDocument } from 'htmlparser2';
import type { ChildNode as ParsedChildNode, Element as ParsedElement, ParentNode as ParsedParentNode } from 'domhandler';

const STRIP_CONTENT_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'noscript', 'title',
]);
const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 'ins']);
const BLOCK_TAGS = new Set([
    'p', 'div', 'blockquote', 'pre', 'address', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'dt', 'dd', 'figcaption', 'td', 'th', 'caption', 'center',
]);
const CONTAINER_TAGS = new Set([
    'span', 'font', 'a', 'section', 'article', 'aside', 'header', 'footer', 'main',
    'nav', 'figure', 'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr',
    'colgroup', 'col', 'ruby', 'rt', 'rp', 'small',
    'big', 'sub', 'sup', 'code', 'samp', 'kbd', 'mark', 'del', 's', 'strike',
]);

function getAttribute(node: ParsedElement, name: string): string {
    return node.attribs?.[name] || '';
}

function getChildren(node: ParsedParentNode): ParsedChildNode[] {
    return Array.isArray(node.children) ? node.children : [];
}

function extractAllowedAlignment(el: ParsedElement): 'left' | 'center' | null {
    if (el.name.toLowerCase() === 'center') return 'center';

    const alignAttr = getAttribute(el, 'align').trim().toLowerCase();
    if (alignAttr === 'left' || alignAttr === 'center' || alignAttr === 'centre') {
        return alignAttr === 'centre' ? 'center' : alignAttr;
    }

    const styleAttr = getAttribute(el, 'style');
    const match = styleAttr.match(/(?:^|;)\s*text-align\s*:\s*([^;]+)/i);
    if (!match) return null;

    const styleValue = match[1].trim().toLowerCase();
    if (styleValue === 'left' || styleValue === 'center' || styleValue === 'centre') {
        return styleValue === 'centre' ? 'center' : styleValue;
    }
    return null;
}

function extractAllowedInlineFormatting(
    el: ParsedElement,
    explicit: { bold?: boolean; italic?: boolean; underline?: boolean } = {},
): { bold: boolean; italic: boolean; underline: boolean } {
    const tag = el.name.toLowerCase();
    const style = getAttribute(el, 'style');
    const fontWeight = style.match(/(?:^|;)\s*font-weight\s*:\s*([^;]+)/i)?.[1].trim().toLowerCase() || '';
    const fontStyle = style.match(/(?:^|;)\s*font-style\s*:\s*([^;]+)/i)?.[1].trim().toLowerCase() || '';
    const textDecoration = style.match(/(?:^|;)\s*text-decoration(?:-line)?\s*:\s*([^;]+)/i)?.[1].trim().toLowerCase() || '';
    const numericWeight = Number.parseInt(fontWeight, 10);

    return {
        bold: !!explicit.bold ||
            tag === 'strong' ||
            tag === 'b' ||
            fontWeight === 'bold' ||
            fontWeight === 'bolder' ||
            (Number.isFinite(numericWeight) && numericWeight >= 600),
        italic: !!explicit.italic ||
            tag === 'em' ||
            tag === 'i' ||
            fontStyle === 'italic' ||
            fontStyle === 'oblique',
        underline: !!explicit.underline ||
            tag === 'u' ||
            tag === 'ins' ||
            textDecoration.split(/\s+/).includes('underline'),
    };
}

function hasRenderableContent(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
        return !!node.textContent?.trim();
    }

    if (!(node instanceof Element)) return false;
    if (node.tagName.toLowerCase() === 'br' || node.tagName.toLowerCase() === 'hr') return true;
    return Array.from(node.childNodes).some(child => hasRenderableContent(child));
}

function wrapNodes(
    nodes: Node[],
    tagName: 'strong' | 'em' | 'u',
    doc: Document,
): Node[] {
    if (nodes.length === 0) return [];
    const wrapper = doc.createElement(tagName);
    nodes.forEach(child => wrapper.appendChild(child));
    return hasRenderableContent(wrapper) ? [wrapper] : [];
}

function applyAllowedInlineFormatting(
    nodes: Node[],
    source: ParsedElement,
    doc: Document,
    explicit: { bold?: boolean; italic?: boolean; underline?: boolean } = {},
): Node[] {
    const formatting = extractAllowedInlineFormatting(source, explicit);
    let result = nodes;
    if (formatting.underline) result = wrapNodes(result, 'u', doc);
    if (formatting.italic) result = wrapNodes(result, 'em', doc);
    if (formatting.bold) result = wrapNodes(result, 'strong', doc);
    return result;
}

function sanitizeChildren(source: ParsedParentNode, doc: Document): Node[] {
    const sanitized: Node[] = [];
    getChildren(source).forEach(child => {
        sanitized.push(...sanitizeNode(child, doc));
    });
    return sanitized;
}

function sanitizeNode(node: ParsedChildNode, doc: Document): Node[] {
    if (node.type === 'text') {
        return node.data ? [doc.createTextNode(node.data)] : [];
    }

    if (node.type === 'comment' || node.type === 'directive') return [];
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return [];

    const tag = node.name.toLowerCase();
    if (STRIP_CONTENT_TAGS.has(tag)) return [];
    if (tag === 'hr') return [doc.createElement('hr')];
    if (tag === 'br') return [doc.createElement('br')];

    if (tag === 'img') {
        const alt = getAttribute(node, 'alt').trim();
        return [doc.createTextNode(alt || '[Image]')];
    }

    if (INLINE_TAGS.has(tag)) {
        return applyAllowedInlineFormatting(sanitizeChildren(node, doc), node, doc);
    }

    if (tag === 'p' || tag === 'div' || BLOCK_TAGS.has(tag)) {
        const blockTag = tag === 'p' ? 'p' : 'div';
        const el = doc.createElement(blockTag);
        const alignment = extractAllowedAlignment(node);
        if (alignment) el.setAttribute('align', alignment);
        applyAllowedInlineFormatting(sanitizeChildren(node, doc), node, doc)
            .forEach(child => el.appendChild(child));
        return hasRenderableContent(el) ? [el] : [];
    }

    if (CONTAINER_TAGS.has(tag)) {
        return applyAllowedInlineFormatting(sanitizeChildren(node, doc), node, doc);
    }

    return applyAllowedInlineFormatting(sanitizeChildren(node, doc), node, doc);
}

export function sanitizeEditorHtml(html: string): string {
    const sourceDoc = parseDocument(html, {
        lowerCaseAttributeNames: true,
        lowerCaseTags: true,
        recognizeSelfClosing: true,
    });

    const sanitizedDoc = document.implementation.createHTMLDocument('');
    const sanitizedRoot = sanitizedDoc.createElement('div');
    sanitizeChildren(sourceDoc, sanitizedDoc).forEach(child => sanitizedRoot.appendChild(child));
    Array.from(sanitizedRoot.childNodes).forEach(child => {
        if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) {
            sanitizedRoot.removeChild(child);
        }
    });
    return sanitizedRoot.innerHTML;
}
