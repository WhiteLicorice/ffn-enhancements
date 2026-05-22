import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

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
    const archiveEntries = {};
    await addDirectory(archiveEntries, DIST_DIR);
    const archive = zipSync(archiveEntries, { level: 9 });
    await writeFile(OUTPUT_PATH, archive);
    console.log(`Packaged ${PACKAGE_NAME} (${archive.length} bytes).`);
}

async function addDirectory(archiveEntries, dir) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            await addDirectory(archiveEntries, fullPath);
            continue;
        }

        const archivePath = relative(DIST_DIR, fullPath).split(sep).join('/');
        archiveEntries[archivePath] = await readFile(fullPath);
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
