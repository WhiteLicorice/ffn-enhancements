#!/usr/bin/env node
// Orchestrates the per-entry Vite build for FFN Enhancements.
//
// Background: A multi-entry Vite build de-dupes shared modules (most notably
// `webextension-polyfill`) into a `chunks/` directory and emits cross-bundle
// `import { x } from '../chunks/...'` statements at the top of each consumer.
// Manifest V3 loads content scripts as CLASSIC scripts in both Chrome and
// Firefox, so those imports become SyntaxErrors and the content scripts never
// execute. Effect: the extension fails to inject any UI.
//
// This script invokes Vite once per entry with `FFNE_ENTRY` set, producing
// single-entry self-contained bundles. After all sub-builds finish, it copies
// the static `extension/*` assets and patches `manifest.json` for the target
// browser.
//
// Usage:
//   node scripts/build-all.mjs           # build current FFNE_TARGET (default chrome)
//   node scripts/build-all.mjs --watch   # watch mode (parallel watchers)

import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { copyDirRecursive, patchManifest } from './manifest-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

const watch = process.argv.includes('--watch');
const target = process.env.FFNE_TARGET === 'firefox' ? 'firefox' : 'chrome';
const outDir = resolve(root, `dist-${target}`);
const configFile = resolve(root, 'vite.config.ts');

const ENTRY_KEYS = ['sw', 'prelude', 'main'];

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

async function buildEntry(entry) {
    process.env.FFNE_ENTRY = entry;
    process.env.FFNE_TARGET = target;
    return build({
        root,
        configFile,
        logLevel: 'info',
        build: watch ? { watch: {} } : undefined,
    });
}

function copyAssetsAndPatchManifest() {
    const extensionDir = resolve(root, 'extension');
    copyDirRecursive(extensionDir, outDir);
    patchManifest(join(outDir, 'manifest.json'));
}

if (watch) {
    const watchers = [];
    for (const entry of ENTRY_KEYS) {
        watchers.push(await buildEntry(entry));
    }
    copyAssetsAndPatchManifest();

    const shutdown = async () => {
        for (const w of watchers) {
            if (w && typeof w.close === 'function') {
                try { await w.close(); } catch { /* ignore */ }
            }
        }
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
} else {
    for (const entry of ENTRY_KEYS) {
        await buildEntry(entry);
    }
    copyAssetsAndPatchManifest();
}
