// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { patchManifest } from '../../vite.config';

const SOURCE_MANIFEST = {
    manifest_version: 3,
    background: { service_worker: 'background/service-worker.js', type: 'module' },
    browser_specific_settings: { gecko: { id: 'test@test', strict_min_version: '140.0' } },
};

describe('patchManifest', () => {
    let dir: string;
    let manifestPath: string;
    const originalTarget = process.env.FFNE_TARGET;
    const originalVersion = process.env.FFNE_VERSION;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'ffne-patch-'));
        manifestPath = join(dir, 'manifest.json');
        writeFileSync(manifestPath, JSON.stringify(SOURCE_MANIFEST, null, 2));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        if (originalTarget === undefined) {
            delete process.env.FFNE_TARGET;
        } else {
            process.env.FFNE_TARGET = originalTarget;
        }
        if (originalVersion === undefined) {
            delete process.env.FFNE_VERSION;
        } else {
            process.env.FFNE_VERSION = originalVersion;
        }
    });

    it('emits scripts only for Firefox, no service_worker, no type', () => {
        process.env.FFNE_TARGET = 'firefox';

        patchManifest(manifestPath);

        const result = JSON.parse(readFileSync(manifestPath, 'utf8'));
        expect(result.background).toEqual({ scripts: ['background/service-worker.js'] });
        expect(result.background).not.toHaveProperty('service_worker');
        expect(result.background).not.toHaveProperty('type');
        expect(result.browser_specific_settings).toBeDefined();
    });

    it('keeps service_worker + type:module for Chrome, drops browser_specific_settings', () => {
        process.env.FFNE_TARGET = 'chrome';

        patchManifest(manifestPath);

        const result = JSON.parse(readFileSync(manifestPath, 'utf8'));
        expect(result.background).toEqual({
            service_worker: 'background/service-worker.js',
            type: 'module',
        });
        expect(result.browser_specific_settings).toBeUndefined();
    });

    it('uses FFNE_VERSION for manifest version and display version', () => {
        process.env.FFNE_TARGET = 'chrome';
        process.env.FFNE_VERSION = '1.2.3-rc.1';

        patchManifest(manifestPath);

        const result = JSON.parse(readFileSync(manifestPath, 'utf8'));
        expect(result.version).toBe('1.2.3');
        expect(result.version_name).toBe('1.2.3-rc.1');
    });

    it('converts beta build metadata to a browser-safe four-part manifest version', () => {
        process.env.FFNE_TARGET = 'firefox';
        process.env.FFNE_VERSION = '1.2.3-beta.45+abc1234';

        patchManifest(manifestPath);

        const result = JSON.parse(readFileSync(manifestPath, 'utf8'));
        expect(result.version).toBe('1.2.3.45');
        expect(result.version_name).toBe('1.2.3-beta.45+abc1234');
    });

    it('falls back to package.json version when FFNE_VERSION is not set', () => {
        process.env.FFNE_TARGET = 'chrome';
        delete process.env.FFNE_VERSION;
        const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

        patchManifest(manifestPath);

        const result = JSON.parse(readFileSync(manifestPath, 'utf8'));
        expect(result.version).toBe(packageJson.version);
        expect(result.version_name).toBe(packageJson.version);
    });
});
