// Post-build scanner: replaces non-ASCII bytes in JS bundles with \uXXXX
// escape sequences. Firefox versions prior to the current release window
// can reject extensions with non-ASCII content in scripts.
//
// Usage:
//   node scripts/sanitize-dist.mjs <dist-dir>
//   import { sanitizeDirectory } from './sanitize-dist.mjs';

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const JS_EXT = '.js';

export function sanitizeDirectory(dir) {
    let count = 0;
    walk(dir, (path) => { if (sanitizeFile(path)) count++; });
    if (count > 0) console.log(`[sanitize] Sanitized ${count} JS file(s) in ${dir}`);
    return count;
}

function walk(dir, fn) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, fn);
        else if (extname(entry.name) === JS_EXT) fn(full);
    }
}

function sanitizeFile(path) {
    const content = readFileSync(path, 'utf8');
    const escaped = content.replace(
        /[\x80-퟿-￿]|[\uD800-\uDBFF][\uDC00-\uDFFF]/g,
        (m) => {
            const cp = m.codePointAt(0);
            if (cp <= 0xFFFF) return `\\u${cp.toString(16).padStart(4, '0')}`;
            const hi = ((cp - 0x10000) >> 10) + 0xD800;
            const lo = ((cp - 0x10000) & 0x3FF) + 0xDC00;
            return `\\u${hi.toString(16)}\\u${lo.toString(16)}`;
        },
    );
    if (content === escaped) return false;
    writeFileSync(path, escaped, 'utf8');
    console.log(`  [sanitize] ${path}`);
    return true;
}

// Standalone invocation
const arg = process.argv[2];
if (arg) sanitizeDirectory(arg);
