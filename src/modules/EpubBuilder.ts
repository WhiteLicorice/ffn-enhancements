// modules/EpubBuilder.ts

import { Core } from './Core';
import { saveAs } from 'file-saver';
import { StoryMetadata } from '../interfaces/StoryMetadata';
import { ChapterData } from '../interfaces/ChapterData';
import { blobToBytes, bytesToArrayBuffer, createZip, textToBytes, type ZipFileEntry } from '../utils/zip';

/** Serializes a DOM Document to an OPF XML string with the EPUB-required XML declaration. */
function _serializeOpfDocument(doc: Document): string {
    const serializer = new XMLSerializer();
    let xml = serializer.serializeToString(doc);
    if (!xml.startsWith('<?xml')) {
        xml = '<?xml version="1.0" encoding="utf-8"?>\n' + xml;
    }
    return xml;
}

/**
 * A client-side EPUB generator that creates valid EPUB v2 files.
 * Designed to have parity with FicHub's output structure.
 */
export const EpubBuilder = {
    MODULE_NAME: 'EpubBuilder',

    /**
     * Generates and triggers a download of the EPUB file.
     */
    build: async function (meta: StoryMetadata, chapters: ChapterData[]) {
        const log = Core.getLogger(this.MODULE_NAME, 'build');
        log(`Generating EPUB for "${meta.title}" with ${chapters.length} chapters.`);

        const entries: ZipFileEntry[] = [
            {
                path: 'mimetype',
                data: textToBytes('application/epub+zip'),
                options: { level: 0 },
            },
            {
                path: 'META-INF/container.xml',
                data: textToBytes(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`),
            },
        ];

        const css = `
            body { font-family: "Times New Roman", serif; line-height: 1.5; margin: 5%; }
            h1, h2, h3 { text-align: center; }
            p { text-indent: 1em; margin-top: 0; margin-bottom: 0.5em; }
            hr { border: 0; border-bottom: 1px solid #ccc; margin: 20px 0; }
            ul.toc { list-style-type: none; padding: 0; }
            ul.toc li { margin-bottom: 0.5em; }
            .title-page { text-align: center; margin-top: 10%; }
            .cover-img { max-width: 100%; height: auto; max-height: 500px; margin-bottom: 1em; display: block; margin-left: auto; margin-right: auto; }
            .meta-info { margin-top: 2em; font-size: 0.9em; color: #555; text-align: center; }
            .meta-table { margin: 1em auto; width: 80%; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; padding: 10px; font-size: 0.8em; text-align: left; }
            .meta-row { margin-bottom: 5px; }
            .label { font-weight: bold; margin-right: 5px; }
            a { color: inherit; text-decoration: none; border-bottom: 1px dashed #555; }
        `;
        entries.push({ path: 'OEBPS/style.css', data: textToBytes(css) });

        let coverMime = 'image/jpeg';
        if (meta.coverBlob) {
            coverMime = meta.coverBlob.type || 'image/jpeg';
            const ext = coverMime.includes('png') ? 'png' : 'jpg';
            entries.push({ path: `OEBPS/cover.${ext}`, data: await blobToBytes(meta.coverBlob), options: { level: 0 } });
            entries.push({ path: 'OEBPS/cover.xhtml', data: textToBytes(this.generateCoverPage(ext)) });
        }

        entries.push({ path: 'OEBPS/title.xhtml', data: textToBytes(this.generateTitlePage(meta, chapters.length)) });
        entries.push({ path: 'OEBPS/toc.xhtml', data: textToBytes(this.generateTOCPage(meta, chapters)) });
        entries.push({ path: 'OEBPS/content.opf', data: textToBytes(this.generateOPF(meta, chapters, coverMime)) });
        entries.push({ path: 'OEBPS/toc.ncx', data: textToBytes(this.generateNCX(meta, chapters)) });

        chapters.forEach((chap) => {
            const filename = `OEBPS/chapter_${chap.number}.xhtml`;
            entries.push({ path: filename, data: textToBytes(this.generateXHTML(chap.title, chap.content)) });
        });

        const epubBytes = createZip(entries, { level: 1 });
        const blob = new Blob([bytesToArrayBuffer(epubBytes)], { type: 'application/epub+zip' });

        saveAs(blob, `${meta.title} - ${meta.author}.epub`);
        log('Download triggered.');
    },

    /**
     * Generates a dedicated Cover Page using SVG wrapping.
     * This technique forces the image to scale to fit ANY screen size perfectly
     * without scrollbars, though white bars (aspect ratio) are normal.
     */
    generateCoverPage: function (ext: string = 'jpg'): string {
        return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
    <title>Cover</title>
    <style type="text/css">
        @page { padding: 0; margin: 0; }
        body { text-align: center; padding: 0; margin: 0; }
        div { padding: 0; margin: 0; text-align: center; }
        img { width: 100%; height: 100%; max-width: 100%; }
    </style>
</head>
<body>
    <div>
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100%" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid meet">
            <image width="600" height="800" xlink:href="cover.${ext}" />
        </svg>
    </div>
</body>
</html>`;
    },

    /**
     * Generates the Title Page XHTML.
     * Includes extended metadata if available.
     */
    generateTitlePage: function (meta: StoryMetadata, chapterCount: number): string {
        // Assume jpg for internal display if blob exists, browser handles actual decoding
        // If we really wanted to be strict we'd pass the extension here too, but HTML is forgiving.
        const ext = (meta.coverBlob?.type.includes('png')) ? 'png' : 'jpg';

        const coverHtml = meta.coverBlob
            ? `<div class="cover"><img src="cover.${ext}" alt="Cover Image" class="cover-img"/></div>`
            : '';

        const authorHtml = meta.authorUrl
            ? `<a href="${this.escape(meta.authorUrl)}">${this.escape(meta.author)}</a>`
            : this.escape(meta.author);

        const sourceHtml = meta.storyUrl
            ? `<a href="${this.escape(meta.storyUrl)}">${this.escape(meta.source)}</a>`
            : this.escape(meta.source);

        // Helper to generate a metadata row if the value exists
        const metaRow = (label: string, value?: string) =>
            value ? `<div class="meta-row"><span class="label">${label}:</span> ${this.escape(value)}</div>` : '';

        return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>${this.escape(meta.title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
    <div class="title-page">
        ${coverHtml}
        <h1>${this.escape(meta.title)}</h1>
        <h2>by ${authorHtml}</h2>
        
        <div class="meta-info">
            <p>${this.escape(meta.description)}</p>
        </div>

        <div class="meta-table">
            <div class="meta-row"><span class="label">Source:</span> ${sourceHtml}</div>
            <div class="meta-row"><span class="label">ID:</span> ${this.escape(meta.id)}</div>
            ${metaRow('Rated', meta.rating)}
            ${metaRow('Genre', meta.genre)}
            ${metaRow('Language', meta.language)}
            ${metaRow('Status', meta.status)}
            ${metaRow('Chapters', chapterCount.toString())}
            ${metaRow('Words', meta.words)}
            ${metaRow('Published', meta.published)}
            ${metaRow('Updated', meta.updated)}
            ${metaRow('Characters', meta.characters)}
            ${metaRow('Reviews', meta.reviews)}
            ${metaRow('Favs', meta.favs)}
            ${metaRow('Follows', meta.follows)}
        </div>
    </div>
</body>
</html>`;
    },

    /**
     * Generates the visual Table of Contents XHTML page.
     */
    generateTOCPage: function (_meta: StoryMetadata, chapters: ChapterData[]): string {
        const listItems = chapters.map(chap =>
            `<li><a href="chapter_${chap.number}.xhtml">${this.escape(chap.title)}</a></li>`
        ).join('\n');

        return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>Table of Contents</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
    <h2>Table of Contents</h2>
    <hr/>
    <ul class="toc">
        ${listItems}
    </ul>
</body>
</html>`;
    },

    generateOPF: function (meta: StoryMetadata, chapters: ChapterData[], coverMime: string): string {
        const OPF_NS = "http://www.idpf.org/2007/opf";
        const DC_NS  = "http://purl.org/dc/elements/1.1/";

        const doc = document.implementation.createDocument(OPF_NS, "package", null);
        const pkg = doc.documentElement!;
        pkg.setAttribute("unique-identifier", "BookId");
        pkg.setAttribute("version", "2.0");

        // --- <metadata> ---
        const metadata = doc.createElementNS(OPF_NS, "metadata");
        metadata.setAttribute("xmlns:dc", DC_NS);
        metadata.setAttribute("xmlns:opf", OPF_NS);

        function addDc(name: string, value: string) {
            const el = doc.createElementNS(DC_NS, "dc:" + name);
            el.textContent = value;
            metadata.appendChild(el);
        }

        addDc("title", meta.title);

        const creator = doc.createElementNS(DC_NS, "dc:creator");
        creator.setAttribute("opf:role", "aut");
        creator.textContent = meta.author;
        metadata.appendChild(creator);

        const language = doc.createElementNS(DC_NS, "dc:language");
        language.textContent = meta.language ? meta.language.slice(0, 2).toLowerCase() : 'en';
        metadata.appendChild(language);

        addDc("description", meta.description || '');
        addDc("subject", meta.genre || '');

        const identifier = doc.createElementNS(DC_NS, "dc:identifier");
        identifier.setAttribute("id", "BookId");
        identifier.setAttribute("opf:scheme", "UUID");
        identifier.textContent = `urn:uuid:${meta.id}`;
        metadata.appendChild(identifier);

        if (meta.coverBlob) {
            const coverMeta = doc.createElementNS(OPF_NS, "meta");
            coverMeta.setAttribute("name", "cover");
            coverMeta.setAttribute("content", "cover");
            metadata.appendChild(coverMeta);
        }

        pkg.appendChild(metadata);

        // --- <manifest> ---
        const manifest = doc.createElementNS(OPF_NS, "manifest");

        function addItem(id: string, href: string, mediaType: string) {
            const item = doc.createElementNS(OPF_NS, "item");
            item.setAttribute("id", id);
            item.setAttribute("href", href);
            item.setAttribute("media-type", mediaType);
            manifest.appendChild(item);
        }

        addItem("ncx", "toc.ncx", "application/x-dtbncx+xml");
        addItem("style", "style.css", "text/css");
        addItem("titlepage", "title.xhtml", "application/xhtml+xml");
        addItem("toc", "toc.xhtml", "application/xhtml+xml");

        if (meta.coverBlob) {
            const ext = coverMime.includes('png') ? 'png' : 'jpg';
            addItem("cover", `cover.${ext}`, coverMime);
            addItem("cover-page", "cover.xhtml", "application/xhtml+xml");
        }

        chapters.forEach(chap =>
            addItem(`chap${chap.number}`, `chapter_${chap.number}.xhtml`, "application/xhtml+xml")
        );

        pkg.appendChild(manifest);

        // --- <spine> ---
        const spine = doc.createElementNS(OPF_NS, "spine");
        spine.setAttribute("toc", "ncx");

        function addSpineRef(idref: string) {
            const ref = doc.createElementNS(OPF_NS, "itemref");
            ref.setAttribute("idref", idref);
            spine.appendChild(ref);
        }

        if (meta.coverBlob) addSpineRef("cover-page");
        addSpineRef("titlepage");
        addSpineRef("toc");
        chapters.forEach(chap => addSpineRef(`chap${chap.number}`));

        pkg.appendChild(spine);

        // --- <guide> ---
        const guide = doc.createElementNS(OPF_NS, "guide");

        function addRef(type: string, title: string, href: string) {
            const ref = doc.createElementNS(OPF_NS, "reference");
            ref.setAttribute("type", type);
            ref.setAttribute("title", title);
            ref.setAttribute("href", href);
            guide.appendChild(ref);
        }

        if (meta.coverBlob) addRef("cover", "Cover", "cover.xhtml");
        addRef("title-page", "Title Page", "title.xhtml");
        addRef("toc", "Table of Contents", "toc.xhtml");
        addRef("text", "Start", "chapter_1.xhtml");

        pkg.appendChild(guide);

        return _serializeOpfDocument(doc);
    },

    generateNCX: function (meta: StoryMetadata, chapters: ChapterData[]): string {
        // Dynamic Nav Points
        let playOrder = 1;
        let navPoints = '';

        if (meta.coverBlob) {
            navPoints += `
        <navPoint id="navPoint-cover" playOrder="${playOrder++}">
            <navLabel><text>Cover</text></navLabel>
            <content src="cover.xhtml"/>
        </navPoint>`;
        }

        navPoints += `
        <navPoint id="navPoint-title" playOrder="${playOrder++}">
            <navLabel><text>Title Page</text></navLabel>
            <content src="title.xhtml"/>
        </navPoint>
        <navPoint id="navPoint-toc" playOrder="${playOrder++}">
            <navLabel><text>Table of Contents</text></navLabel>
            <content src="toc.xhtml"/>
        </navPoint>`;

        chapters.forEach((chap) => {
            navPoints += `
        <navPoint id="navPoint-${chap.number}" playOrder="${playOrder++}">
            <navLabel><text>${this.escape(chap.title)}</text></navLabel>
            <content src="chapter_${chap.number}.xhtml"/>
        </navPoint>`;
        });

        return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="urn:uuid:${meta.id}"/>
    </head>
    <docTitle><text>${this.escape(meta.title)}</text></docTitle>
    <navMap>
        ${navPoints}
    </navMap>
</ncx>`;
    },

    generateXHTML: function (title: string, bodyContent: string): string {
        // Sanitize content to ensure valid XHTML (closing tags for <br>, <hr>, <img>)
        const validContent = this.makeValidXHTML(bodyContent);

        return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>${this.escape(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
    <h2>${this.escape(title)}</h2>
    <hr/>
    ${validContent}
</body>
</html>`;
    },

    /**
     * Converts loose HTML string (e.g. <br>, <hr>) into strict XHTML string (e.g. <br/>, <hr/>).
     * Necessary because FFN provides HTML4/5 but EPUB requires XML.
     */
    makeValidXHTML: function (html: string): string {
        const parser = new DOMParser();
        // Parse into a real DOM to let the browser handle malformed HTML
        const doc = parser.parseFromString(html, 'text/html');
        const serializer = new XMLSerializer();

        // Serialize children individually to avoid wrapping them in a body tag
        return Array.from(doc.body.childNodes)
            .map(node => serializer.serializeToString(node))
            .join('');
    },

    escape: function (str: string | undefined): string {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
};
