import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

function copyDirRecursive(src: string, dest: string): void {
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

function patchManifest(manifestPath: string): void {
    // Read and patch manifest version/name from env vars.
    // For now, manifest.json is the source of truth; version bumps are manual.
    // This hook is reserved for CI-driven version injection.
    void manifestPath;
}

export default defineConfig({
    plugins: [
        {
            name: 'copy-extension-assets',
            writeBundle() {
                const extensionDir = resolve(__dirname, 'extension');
                const distDir = resolve(__dirname, 'dist');
                copyDirRecursive(extensionDir, distDir);
                patchManifest(join(distDir, 'manifest.json'));
            },
        },
    ],
    build: {
        rollupOptions: {
            input: {
                'content/main': resolve(__dirname, 'src/main.ts'),
                'content/prelude': resolve(__dirname, 'src/prelude/themePrelude.ts'),
                'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
                'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },
        outDir: 'dist',
        emptyOutDir: true,
        minify: 'esbuild',
        cssMinify: true,
        target: 'es2020',
        modulePreload: false,
    },
});
