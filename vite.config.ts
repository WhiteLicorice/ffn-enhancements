import { transformSync } from 'esbuild';
import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { buildCriticalThemeCss } from './src/build/criticalThemeCss';
import { installCriticalThemePrelude } from './src/prelude/themePrelude';

export const CRITICAL_THEME_DECODED_SIZE_BUDGET = 15_000;
export const CRITICAL_THEME_METADATA_LINE_BUDGET = 25_000;

const CRITICAL_THEME_REQUIRE_PREFIX = 'data:application/javascript,';
const CRITICAL_THEME_PRELUDE_CONFIG = {
  styleId: 'ffne-theme-critical',
  storageKey: 'ffne_theme',
  cacheKey: 'ffne_theme_cache',
  preludeAttribute: 'data-ffne-prelude',
  validThemes: ['system', 'light', 'dark', 'sepia', 'high-contrast'],
} as const;

export function makeCriticalThemeRequire(): string {
  const preludeIife = transformSync(
    `(${installCriticalThemePrelude.toString()})(${JSON.stringify(buildCriticalThemeCss())},${JSON.stringify(CRITICAL_THEME_PRELUDE_CONFIG)});`,
    {
      loader: 'js',
      minify: true,
      legalComments: 'none',
      target: 'es2020',
    },
  ).code.trim();

  const decodedBytes = Buffer.byteLength(preludeIife, 'utf8');
  if (decodedBytes >= CRITICAL_THEME_DECODED_SIZE_BUDGET) {
    throw new Error(`Critical theme prelude decoded payload exceeds ${CRITICAL_THEME_DECODED_SIZE_BUDGET} bytes: ${decodedBytes}`);
  }

  const requireValue = `${CRITICAL_THEME_REQUIRE_PREFIX}${encodeURIComponent(preludeIife)}`;
  const metadataLineLength = `// @require      ${requireValue}`.length;
  if (metadataLineLength >= CRITICAL_THEME_METADATA_LINE_BUDGET) {
    throw new Error(`Critical theme prelude metadata line exceeds ${CRITICAL_THEME_METADATA_LINE_BUDGET} characters: ${metadataLineLength}`);
  }

  return requireValue;
}

const BETA = process.env.FFNE_BETA === 'true';
const VERSION = process.env.FFNE_VERSION || '0.0.0-dev';

const USERSCRIPT_NAME = BETA ? 'FFN Enhancements (Beta)' : 'FFN Enhancements';
const DOWNLOAD_URL = BETA
  ? 'https://github.com/WhiteLicorice/ffn-enhancements/releases/download/beta/ffn-enhancements.beta.user.js'
  : 'https://github.com/WhiteLicorice/ffn-enhancements/releases/latest/download/ffn-enhancements.user.js';
const OUTPUT_FILE = BETA ? 'ffn-enhancements.beta.user.js' : 'ffn-enhancements.user.js';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: USERSCRIPT_NAME,
        namespace: 'http://tampermonkey.net/',
        version: VERSION,
        author: 'WhiteLicorice',
        connect: ['fichub.net', 'archiveofourown.org', 'www.fanfiction.net', 'fanfiction.net'],
        match: ['https://www.fanfiction.net/*', 'https://archiveofourown.org/*'],
        'run-at': 'document-start',
        noframes: true,
        grant: [
          'GM_xmlhttpRequest',
          'GM_getValue',
          'GM_setValue',
          'GM_registerMenuCommand',
          'GM_unregisterMenuCommand',
          'GM_addValueChangeListener',
          'GM_deleteValue',
          'GM_openInTab',
          'GM_setClipboard',
        ],
        require: [makeCriticalThemeRequire()],
        license: 'GPL-3.0-or-later',
        updateURL: DOWNLOAD_URL,
        downloadURL: DOWNLOAD_URL,
      },
      build: {
        fileName: OUTPUT_FILE,
      },
    }),
  ],
  build: {
    minify: 'esbuild',
    cssMinify: true,
    target: 'es2020',
  },
});
