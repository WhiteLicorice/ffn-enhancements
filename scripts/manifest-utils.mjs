// Shared helpers for the multi-target build pipeline. Imported by:
//   - vite.config.ts (re-exports `patchManifest` for the unit tests)
//   - scripts/build-all.mjs (the per-entry build orchestrator)
//
// Kept in plain ESM so plain `node` can load it without a TS toolchain.

import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export function getBuildTarget() {
    return process.env.FFNE_TARGET === 'firefox' ? 'firefox' : 'chrome';
}

export function getOutDir() {
    return getBuildTarget() === 'firefox' ? 'dist-firefox' : 'dist-chrome';
}

export function copyDirRecursive(src, dest) {
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

export function patchManifest(manifestPath) {
    const target = getBuildTarget();
    const requestedVersion = process.env.FFNE_VERSION;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    if (requestedVersion) {
        manifest.version = toManifestVersion(requestedVersion);
        manifest.version_name = requestedVersion;
    }

    if (target === 'firefox') {
        // Firefox MV3 uses event pages (background.scripts), NOT service workers.
        // CRITICAL: emit ONLY `scripts`. Including both `service_worker` and
        // `scripts` makes Firefox prefer the SW key and silently fail loading,
        // since `chrome.action.*` is not on the SW scope and there is no
        // `type: "module"` (and we cannot add one — module scripts defer past
        // the event-page wake-up dispatch).
        manifest.background = {
            scripts: ['background/service-worker.js'],
        };
    } else {
        delete manifest.browser_specific_settings;
    }

    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function toManifestVersion(version) {
    const core = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!core) return '0.0.0';

    const betaBuild = version.match(/beta\.(\d+)/);
    if (!betaBuild) return `${core[1]}.${core[2]}.${core[3]}`;

    const build = Number(betaBuild[1]);
    const safeBuild = Number.isFinite(build) ? Math.max(0, Math.min(build, 65535)) : 0;
    return `${core[1]}.${core[2]}.${core[3]}.${safeBuild}`;
}
