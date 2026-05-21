import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'extension/manifest.json'), 'utf8'),
) as {
    host_permissions: string[];
    optional_host_permissions?: string[];
    content_scripts: Array<{ css?: string[]; js?: string[] }>;
};

describe('manifest permissions', () => {
    it('keeps FFN, AO3, and FicHub as required host permissions', () => {
        expect(manifest.host_permissions).toEqual([
            '*://www.fanfiction.net/*',
            '*://fanfiction.net/*',
            '*://archiveofourown.org/*',
            '*://fichub.net/*',
        ]);
    });

    it('does not keep FicHub as an optional host permission', () => {
        expect(manifest.optional_host_permissions).toBeUndefined();
    });
});
