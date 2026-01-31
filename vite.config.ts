import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'FFN Enhancements',
        namespace: 'http://tampermonkey.net/',
        version: '6.0',
        author: 'WhiteLicorice',
        match: ['https://www.fanfiction.net/*'],
        grant: ['GM_xmlhttpRequest'],
        // This plugin automatically handles @require for libraries
      },
      build: {
        fileName: 'ffn-enhancements.user.js',
      },
    }),
  ],
});