import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const repoRoot = path.resolve(import.meta.dirname, '..');
const distPath = path.join(repoRoot, 'dist', 'ffn-enhancements.user.js');
const source = fs.readFileSync(distPath, 'utf8');
const requireLines = [...source.matchAll(/^\/\/ @require\s+(data:application\/javascript,[^\n]+)$/gm)];

assert.equal(requireLines.length, 1, `Expected exactly one @require data:application/javascript line, found ${requireLines.length}.`);

const [fullLine, requireValue] = requireLines[0];
assert.ok(fullLine.length < 25_000, `Critical theme @require metadata line exceeds 25 KB: ${fullLine.length}`);

const decodedPayload = decodeURIComponent(requireValue.replace('data:application/javascript,', ''));
assert.ok(Buffer.byteLength(decodedPayload, 'utf8') < 15_000, `Critical theme decoded payload exceeds 15 KB: ${Buffer.byteLength(decodedPayload, 'utf8')}`);
assert.match(decodedPayload, /ffne-theme-critical/, 'Decoded payload is missing the critical theme style id.');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'https://www.fanfiction.net/s/1/1/Test',
});

dom.window.localStorage.setItem('ffne_theme_cache', 'dark');
dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() { },
    removeEventListener() { },
});
dom.window.eval(decodedPayload);

assert.ok(dom.window.document.documentElement.classList.contains('ffne-theme-dark'), 'Decoded payload did not apply the expected FFN theme class.');
assert.ok(dom.window.document.getElementById('ffne-theme-critical'), 'Decoded payload did not inject the critical theme style.');

console.log('Critical theme @require payload check passed.');
