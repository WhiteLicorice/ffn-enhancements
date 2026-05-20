import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
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
    const requestedVersion = process.env.FFNE_VERSION;
    if (!requestedVersion) return;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        version?: string;
        version_name?: string;
    };

    manifest.version = toManifestVersion(requestedVersion);
    manifest.version_name = requestedVersion;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function toManifestVersion(version: string): string {
    const core = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!core) return '0.0.0';

    const betaBuild = version.match(/beta\.(\d+)/);
    if (!betaBuild) return `${core[1]}.${core[2]}.${core[3]}`;

    const build = Number(betaBuild[1]);
    const safeBuild = Number.isFinite(build) ? Math.max(0, Math.min(build, 65535)) : 0;
    return `${core[1]}.${core[2]}.${core[3]}.${safeBuild}`;
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
