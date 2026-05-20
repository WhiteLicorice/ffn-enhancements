// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    });

    it('emits scripts only for Firefox, no service_worker, no type', () => {
        process.env.FFNE_TARGET = 'firefox';

        patchManifest(manifestPath);

        const result = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
            background: Record<string, unknown>;
            browser_specific_settings?: Record<string, unknown>;
        };

        expect(result.background).toEqual({ scripts: ['background/service-worker.js'] });
        expect(result.background).not.toHaveProperty('service_worker');
        expect(result.background).not.toHaveProperty('type');
        expect(result.browser_specific_settings).toBeDefined();
    });

    it('keeps service_worker + type:module for Chrome, drops browser_specific_settings', () => {
        process.env.FFNE_TARGET = 'chrome';

        patchManifest(manifestPath);

        const result = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
            background: Record<string, unknown>;
            browser_specific_settings?: Record<string, unknown>;
        };

        expect(result.background).toEqual({
            service_worker: 'background/service-worker.js',
            type: 'module',
        });
        expect(result.browser_specific_settings).toBeUndefined();
    });
});
