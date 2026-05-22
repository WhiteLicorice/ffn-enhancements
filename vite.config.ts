import { defineConfig } from 'vite';
import { resolve } from 'path';
import { getOutDir, patchManifest } from './scripts/manifest-utils.mjs';

// ─── Entry catalog ────────────────────────────────────────────────────────────
//
// Each `vite build` invocation emits exactly ONE entry. The orchestrator at
// `scripts/build-all.mjs` runs three sequential builds, once per entry,
// passing `FFNE_ENTRY=sw|prelude|main` via the environment.
//
// **Why single-entry per build.** Manifest V3 loads content scripts as
// CLASSIC scripts. A multi-entry Vite/Rollup build de-dupes shared modules
// into a `chunks/` file and emits `import { x } from '../chunks/...'`
// at the top of each consumer. That `import` is a SyntaxError in a
// content-script context, so the entire content script fails to execute.
// Service workers tolerate the chunk because Chrome MV3 declares
// `background.type: "module"`, but content scripts have no equivalent
// escape hatch.
//
// Single-entry builds force Rollup to inline every static import into the
// entry bundle. No `chunks/` directory is emitted, no cross-bundle imports
// exist, and content scripts execute under classic-script semantics.
//
// Compatibility uses build-time manifest targeting plus a tiny runtime wrapper:
// Chrome keeps `background.service_worker`, Firefox gets `background.scripts`,
// and `src/platform/extensionApi.ts` prefers `browser.*` with callback-normalized
// `chrome.*` fallback. Non-ASCII safety: `esbuild.charset: 'ascii'` plus
// `scripts/sanitize-dist.mjs` post-build scan.
//
// Re-exports `patchManifest` for unit tests in `src/__tests__/viteConfig.test.ts`.

export { patchManifest };

interface EntrySpec {
    name: string;
    src: string;
    format: 'es' | 'iife';
}

const ENTRIES: Record<string, EntrySpec> = {
    sw: {
        name: 'background/service-worker',
        src: 'src/background/service-worker.ts',
        // Chrome MV3 declares `background.type: "module"`, so ESM would be
        // acceptable, but IIFE works identically in both Chrome's module
        // service-worker and Firefox's classic event-page contexts without
        // relying on inlined-bundle having no import/export statements.
        format: 'iife',
    },
    prelude: {
        name: 'content/prelude',
        src: 'src/prelude/themePrelude.ts',
        format: 'iife',
    },
    main: {
        name: 'content/main',
        src: 'src/main.ts',
        format: 'iife',
    },
};

export type EntryKey = keyof typeof ENTRIES;

function getEntryKey(): EntryKey | null {
    const key = process.env.FFNE_ENTRY;
    if (key && Object.prototype.hasOwnProperty.call(ENTRIES, key)) {
        return key as EntryKey;
    }
    return null;
}

export default defineConfig(() => {
    const entryKey = getEntryKey();
    if (!entryKey) {
        throw new Error(
            'vite.config.ts: FFNE_ENTRY env var is required. '
            + `Set it to one of: ${Object.keys(ENTRIES).join(', ')}. `
            + 'Use `npm run build` to run the full multi-entry orchestrated build.',
        );
    }

    const entry = ENTRIES[entryKey];

    return {
        build: {
            outDir: getOutDir(),
            // The orchestrator wipes the dir before invoking the first build.
            // Subsequent builds in the same target session must NOT empty it.
            emptyOutDir: false,
            minify: 'esbuild' as const,
            cssMinify: true,
            esbuild: {
                charset: 'ascii',
            },
            target: 'es2020',
            modulePreload: false,
            rollupOptions: {
                input: { [entry.name]: resolve(__dirname, entry.src) },
                output: {
                    format: entry.format,
                    entryFileNames: '[name].js',
                    chunkFileNames: 'chunks/[name]-[hash].js',
                    assetFileNames: 'assets/[name]-[hash].[ext]',
                    // Single-entry builds naturally inline everything. This
                    // flag is a safety belt against future Rollup behavior
                    // around code-splitting heuristics.
                    inlineDynamicImports: true,
                },
            },
        },
    };
});
