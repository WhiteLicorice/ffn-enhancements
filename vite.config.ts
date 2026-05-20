import { defineConfig } from 'vite';
import monkey, { util } from 'vite-plugin-monkey';

export default defineConfig(async () => {
  const paintGatePrelude = await util.fn2dataUrl(() => {
    try {
      if (location.hostname !== 'www.fanfiction.net' && location.hostname !== 'fanfiction.net') return;
      var root = document.documentElement;
      if (!root) return;
      root.classList.add('ffne-paint-gated');
      root.style.backgroundColor = '#000';
      var style = document.getElementById('ffne-paint-gate-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'ffne-paint-gate-style';
        root.appendChild(style);
      }
      style.textContent = 'html.ffne-paint-gated,html.ffne-paint-gated body{background:#000 !important;color-scheme:dark !important}html.ffne-paint-gated body{opacity:0 !important;pointer-events:none !important;transition:none !important}html.ffne-paint-gated::before{content:"";position:fixed;inset:0;z-index:2147483647;background:#000;pointer-events:none}';
      var overlay = document.getElementById('ffne-paint-gate-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'ffne-paint-gate-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        root.appendChild(overlay);
      }
      overlay.setAttribute('style', 'position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;z-index:2147483647 !important;background:#000 !important;display:block !important;visibility:visible !important;opacity:1 !important;pointer-events:none !important;margin:0 !important;padding:0 !important;border:0 !important;box-shadow:none !important;contain:strict !important');
    } catch (e) {
    }
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
          require: [
            paintGatePrelude,
            'https://cdn.jsdelivr.net/npm/jszip@3.1.5/dist/jszip.min.js',
            'https://cdn.jsdelivr.net/npm/file-saver@2.0.4/dist/FileSaver.min.js',
            'https://cdn.jsdelivr.net/npm/turndown@7.2.2/lib/turndown.browser.umd.js',
            'https://cdn.jsdelivr.net/npm/marked@17.0.1/lib/marked.umd.js',
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
          externalGlobals: {
            'jszip': ['JSZip'],
            'file-saver': ['saveAs'],
            'turndown': ['TurndownService'],
            'marked': ['marked'],
          },
        },
      }),
    ],
  };
});
