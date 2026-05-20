import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CONTENT_SCRIPT_CSS_FILES,
    CONTENT_SCRIPT_JS_FILES,
    REQUESTED_HOST_PATTERNS,
} from '../background/contentScriptManifest';

const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'extension/manifest.json'), 'utf8'),
) as {
    host_permissions: string[];
    content_scripts: Array<{ css?: string[]; js?: string[] }>;
};

describe('contentScriptManifest matches extension/manifest.json', () => {
    it('REQUESTED_HOST_PATTERNS matches host_permissions', () => {
        expect([...REQUESTED_HOST_PATTERNS].sort()).toEqual(
            [...manifest.host_permissions].sort(),
        );
    });

    it('CSS files match content_scripts[0].css', () => {
        expect(CONTENT_SCRIPT_CSS_FILES).toEqual(manifest.content_scripts[0].css);
    });

    it('JS files match content_scripts[*].js flat', () => {
        const merged = manifest.content_scripts.flatMap((contentScript) => contentScript.js ?? []);
        expect(CONTENT_SCRIPT_JS_FILES).toEqual(merged);
    });
});
