import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGET = process.env.FFNE_TARGET === 'firefox' ? 'firefox' : 'chrome';
const DIST_DIR = join(ROOT, `dist-${TARGET}`);
const PACKAGE_NAME = process.env.FFNE_PACKAGE_NAME
    || defaultPackageName();
const OUTPUT_PATH = join(ROOT, PACKAGE_NAME);

function defaultPackageName() {
    const betaSuffix = process.env.FFNE_BETA === 'true' ? '-beta' : '';
    return `ffn-enhancements-${TARGET}${betaSuffix}.zip`;
}

async function main() {
    const zip = new JSZip();
    await addDirectory(zip, DIST_DIR);
    const archive = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
    });
    await writeFile(OUTPUT_PATH, archive);
    console.log(`Packaged ${PACKAGE_NAME} (${archive.length} bytes).`);
}

async function addDirectory(zip, dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            await addDirectory(zip, fullPath);
            continue;
        }

        const archivePath = relative(DIST_DIR, fullPath).split(sep).join('/');
        zip.file(archivePath, await readFile(fullPath));
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
