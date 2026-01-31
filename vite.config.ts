import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'FFN Enhancements',
        namespace: 'http://tampermonkey.net/',
        version: '5.9',
        description: 'A suite of modern enhancements to FFN\'s old-school interface. Inspired by ao3-enhancements.',
        author: 'WhiteLicorice',
        match: ['https://www.fanfiction.net/*'],
        'run-at': 'document-start',
        grant: ['GM_xmlhttpRequest'],
      },
      build: {
        externalGlobals: {
          jszip: 'JSZip',
          turndown: 'TurndownService',
          'file-saver': 'saveAs',
        },
      },
    }),
  ],
});