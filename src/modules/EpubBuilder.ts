// modules/EpubBuilder.ts

import { Core } from './Core';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { StoryMetadata } from '../interfaces/StoryMetadata';
import { ChapterData } from '../interfaces/ChapterData';

/**
 * A client-side EPUB generator that creates valid EPUB v2 files.
 * Designed to have parity with FicHub's output structure.
 */
export const EpubBuilder = {
    /**
     * Generates and triggers a download of the EPUB file.
     */
    build: async function (meta: StoryMetadata, chapters: ChapterData[]) {
        const log = Core.getLogger('EpubBuilder', 'build');
        log(`Generating EPUB for "${meta.title}" with ${chapters.length} chapters.`);

        const zip = new JSZip();

        // 1. Mimetype (Must be first, uncompressed)
        zip.file('mimetype', 'application/epub+zip', { compression: "STORE" });

        // 2. Container XML
        zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`);

        // 3. Stylesheet
        const css = `
            body { font-family: "Times New Roman", serif; line-height: 1.5; margin: 5%; }
            h1, h2, h3 { text-align: center; }
            p { text-indent: 1em; margin-top: 0; margin-bottom: 0.5em; }
            hr { border: 0; border-bottom: 1px solid #ccc; margin: 20px 0; }
            ul.toc { list-style-type: none; padding: 0; }
            ul.toc li { margin-bottom: 0.5em; }
            .title-page { text-align: center; margin-top: 20%; }
            .cover-img { max-width: 100%; height: auto; margin-bottom: 1em; display: block; margin-left: auto; margin-right: auto; }
            .meta-info { margin-top: 2em; font-size: 0.9em; color: #555; }
        `;
        zip.file('OEBPS/style.css', css);

        // 3.5 Cover Image Handling
        // If we have a cover, we create a dedicated Cover Page (cover.xhtml)
        // This is the standard "Best Practice" for eBooks to look professional.
        if (meta.coverBlob) {
            zip.file('OEBPS/cover.jpg', meta.coverBlob);
            zip.file('OEBPS/cover.xhtml', this.generateCoverPage());
        }

        // 4. Title Page (Text + Little Cover)
        zip.file('OEBPS/title.xhtml', this.generateTitlePage(meta));

        // 5. Table of Contents HTML
        zip.file('OEBPS/toc.xhtml', this.generateTOCPage(meta, chapters));

        // 6. Content.opf (Manifest)
        zip.file('OEBPS/content.opf', this.generateOPF(meta, chapters));

        // 7. TOC.ncx (Navigation)
        zip.file('OEBPS/toc.ncx', this.generateNCX(meta, chapters));

        // 8. Chapter Files
        chapters.forEach((chap) => {
            const filename = `OEBPS/chapter_${chap.number}.xhtml`;
            zip.file(filename, this.generateXHTML(chap.title, chap.content));
        });

        // 9. Generate Blob and Download
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, `${meta.title} - ${meta.author}.epub`);
        log('Download triggered.');
    },

    /**
     * Generates a dedicated Cover Page using SVG wrapping.
     * This technique forces the image to scale to fit ANY screen size perfectly
     * without scrollbars, though white bars (aspect ratio) are normal.
     */
    generateCoverPage: function (): string {
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
            <image width="600" height="800" xlink:href="cover.jpg" />
        </svg>
    </div>
</body>
</html>`;
    },

    /**
     * Generates the Title Page XHTML.
     * Includes the cover image inline above the title.
     */
    generateTitlePage: function (meta: StoryMetadata): string {
        const coverHtml = meta.coverBlob
            ? '<div class="cover"><img src="cover.jpg" alt="Cover Image" class="cover-img"/></div>'
            : '';

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
        <h2>by ${this.escape(meta.author)}</h2>
        <div class="meta-info">
            <p>${this.escape(meta.description)}</p>
            <p>Source: ${this.escape(meta.source)}</p>
            <p>ID: ${this.escape(meta.id)}</p>
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

    generateOPF: function (meta: StoryMetadata, chapters: ChapterData[]): string {
        const uuid = `urn:uuid:${meta.id}`;

        // Add cover image to Manifest if present
        const coverImageItem = meta.coverBlob
            ? '<item id="cover-image" href="cover.jpg" media-type="image/jpeg"/>'
            : '';

        // Add cover PAGE to Manifest if present
        const coverPageItem = meta.coverBlob
            ? '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>'
            : '';

        // Add cover Meta Tag
        const coverMeta = meta.coverBlob
            ? '<meta name="cover" content="cover-image" />'
            : '';

        // Add cover to Spine (First item!)
        const coverSpine = meta.coverBlob
            ? '<itemref idref="cover"/>'
            : '';

        return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>${this.escape(meta.title)}</dc:title>
        <dc:creator opf:role="aut">${this.escape(meta.author)}</dc:creator>
        <dc:language>en</dc:language>
        <dc:description>${this.escape(meta.description)}</dc:description>
        <dc:identifier id="BookId" opf:scheme="UUID">${uuid}</dc:identifier>
        ${coverMeta}
    </metadata>
    <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="style" href="style.css" media-type="text/css"/>
        <item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>
        <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml"/>
        ${coverImageItem}
        ${coverPageItem}
        ${chapters.map((chap) => `<item id="chap${chap.number}" href="chapter_${chap.number}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
    </manifest>
    <spine toc="ncx">
        ${coverSpine}
        <itemref idref="titlepage"/>
        <itemref idref="toc"/>
        ${chapters.map((chap) => `<itemref idref="chap${chap.number}"/>`).join('\n')}
    </spine>
    <guide>
        ${meta.coverBlob ? '<reference type="cover" title="Cover" href="cover.xhtml"/>' : ''}
        <reference type="title-page" title="Title Page" href="title.xhtml"/>
        <reference type="toc" title="Table of Contents" href="toc.xhtml"/>
        <reference type="text" title="Start" href="chapter_1.xhtml"/>
    </guide>
</package>`;
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

    escape: function (str: string): string {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};