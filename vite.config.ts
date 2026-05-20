import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
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
});
