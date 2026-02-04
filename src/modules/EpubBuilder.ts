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
        `;
        zip.file('OEBPS/style.css', css);

        // 4. Content.opf (Manifest)
        zip.file('OEBPS/content.opf', this.generateOPF(meta, chapters));

        // 5. TOC.ncx (Navigation)
        zip.file('OEBPS/toc.ncx', this.generateNCX(meta, chapters));

        // 6. Chapter Files
        chapters.forEach((chap) => {
            // Use the specific chapter number for the filename
            const filename = `OEBPS/chapter_${chap.number}.xhtml`;
            zip.file(filename, this.generateXHTML(chap.title, chap.content));
        });

        // 7. Generate Blob and Download
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, `${meta.title} - ${meta.author}.epub`);
        log('Download triggered.');
    },

    generateOPF: function (meta: StoryMetadata, chapters: ChapterData[]): string {
        const uuid = `urn:uuid:${meta.id}`;
        return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>${this.escape(meta.title)}</dc:title>
        <dc:creator opf:role="aut">${this.escape(meta.author)}</dc:creator>
        <dc:language>en</dc:language>
        <dc:description>${this.escape(meta.description)}</dc:description>
        <dc:identifier id="BookId" opf:scheme="UUID">${uuid}</dc:identifier>
    </metadata>
    <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="style" href="style.css" media-type="text/css"/>
        ${chapters.map((chap) => `<item id="chap${chap.number}" href="chapter_${chap.number}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
    </manifest>
    <spine toc="ncx">
        ${chapters.map((chap) => `<itemref idref="chap${chap.number}"/>`).join('\n')}
    </spine>
</package>`;
    },

    generateNCX: function (meta: StoryMetadata, chapters: ChapterData[]): string {
        return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="urn:uuid:${meta.id}"/>
    </head>
    <docTitle><text>${this.escape(meta.title)}</text></docTitle>
    <navMap>
        ${chapters.map((chap) => `
        <navPoint id="navPoint-${chap.number}" playOrder="${chap.number}">
            <navLabel><text>${this.escape(chap.title)}</text></navLabel>
            <content src="chapter_${chap.number}.xhtml"/>
        </navPoint>`).join('')}
    </navMap>
</ncx>`;
    },

    generateXHTML: function (title: string, bodyContent: string): string {
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
    ${bodyContent}
</body>
</html>`;
    },

    escape: function (str: string): string {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};