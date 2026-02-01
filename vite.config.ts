import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'FFN Enhancements',
        namespace: 'http://tampermonkey.net/',
        version: '7.1',
        author: 'WhiteLicorice',
        match: ['https://www.fanfiction.net/*'],
        grant: ['GM_xmlhttpRequest'],
        license: 'GPL-3.0-or-later',
        // Adding these manually to the Userscript header
        require: [
          'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js',
          'https://cdn.jsdelivr.net/npm/file-saver@2.0.4/dist/FileSaver.min.js',
          'https://cdn.jsdelivr.net/npm/turndown@7.2.2/dist/turndown.js'
        ],
      },
      build: {
        fileName: 'ffn-enhancements.user.js',
        // This maps the import statements in TS to the Global Variables 
        // provided by the CDN scripts above.
        externalGlobals: {
          'jszip': 'JSZip',
          'file-saver': 'saveAs',
          'turndown': 'TurndownService',
        },
      },
    }),
  ],
});