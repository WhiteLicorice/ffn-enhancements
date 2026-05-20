import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import monkey, { util } from 'vite-plugin-monkey';
import { buildCriticalThemeCss } from './src/build/criticalThemeCss';
import {
  CRITICAL_THEME_STYLE_ID,
  installCriticalThemePrelude,
  PRELUDE_ATTRIBUTE,
  THEME_CACHE_KEY,
  THEME_STORAGE_KEY,
  VALID_PRELUDE_THEMES,
} from './src/prelude/themePrelude';

export default defineConfig(async () => {
  const nativeOverrideStyles = readFileSync(join(process.cwd(), 'src/styles/native-overrides.css'), 'utf8');
  const criticalThemeCss = buildCriticalThemeCss(nativeOverrideStyles);
  const criticalThemePrelude = await util.fn2dataUrl(installCriticalThemePrelude, criticalThemeCss, {
    styleId: CRITICAL_THEME_STYLE_ID,
    storageKey: THEME_STORAGE_KEY,
    cacheKey: THEME_CACHE_KEY,
    preludeAttribute: PRELUDE_ATTRIBUTE,
    validThemes: VALID_PRELUDE_THEMES,
  });

  return {
    plugins: [
      monkey({
        entry: 'src/main.ts',
        userscript: {
          name: 'FFN Enhancements',
          namespace: 'http://tampermonkey.net/',
          version: '15.0',
          author: 'WhiteLicorice',
          connect: ['fichub.net', 'archiveofourown.org', 'www.fanfiction.net', 'fanfiction.net'],
          match: ['https://www.fanfiction.net/*', 'https://archiveofourown.org/*'],
          'run-at': 'document-start',
          noframes: true,
          require: [
            criticalThemePrelude,
          ],
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
          license: 'GPL-3.0-or-later',
          updateURL: 'https://github.com/WhiteLicorice/ffn-enhancements/releases/latest/download/ffn-enhancements.user.js',
          downloadURL: 'https://github.com/WhiteLicorice/ffn-enhancements/releases/latest/download/ffn-enhancements.user.js',
        },
        build: {
          fileName: 'ffn-enhancements.user.js',
        },
      }),
    ],
    build: {
      minify: 'esbuild',
      cssMinify: true,
      target: 'es2020',
    },
  };
});
