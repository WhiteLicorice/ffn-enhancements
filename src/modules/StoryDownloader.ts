// modules/StoryDownloader.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import { FicHubDownloader } from './FicHubDownloader';
import { NativeDownloader } from './NativeDownloader';
import { SupportedFormats } from '../enums/SupportedFormats';
import { markFfneUiRoot } from '../utils/ffneUi';
import { ThemeManager } from './ThemeManager';
import { h } from '../utils/dom';

function _buildDownloadModal(): HTMLElement {
    return h('div', {
        class: 'modal fade hide',
        id: 'ffe-download-modal',
        style: 'display: none;',
    },
    h('div', { class: 'modal-header' },
        h('button', { type: 'button', class: 'close', id: 'ffe-modal-close-x' }, '\u00d7'),
        h('h3', { id: 'ffe-modal-title', class: 'ffne-dl-modal-title' }, 'Select Download Method'),
    ),
    h('div', { class: 'modal-body ffne-dl-modal-body' },
        h('p', { class: 'ffne-dl-modal-intro' }, 'Choose a source for your file:'),
        h('div', { class: 'ffne-dl-modal-actions' },
            h('button', { id: 'ffe-btn-native', class: 'btn icon-book ffne-dl-source-btn' },
                'Native',
                h('br'),
                h('span', { class: 'ffne-dl-source-subtitle' }, '(Browser)'),
            ),
            h('button', { id: 'ffe-btn-fichub', class: 'btn icon-cloud-download ffne-dl-source-btn' },
                'FicHub',
                h('br'),
                h('span', { class: 'ffne-dl-source-subtitle' }, '(Archive)'),
            ),
        ),
        h('div', { class: 'alert alert-info ffne-dl-note' },
            h('ul', { class: 'ffne-dl-note-list' },
                h('li', null,
                    h('strong', null, 'Native:'),
                    ' Generates the file directly from this page. Guaranteed to be the latest version, but takes longer.',
                ),
                h('li', null,
                    h('strong', null, 'FicHub:'),
                    ' Downloads from the FicHub archive. Very fast, but the file might be slightly older (cached).',
                ),
            ),
        ),
    ),
    h('div', { class: 'modal-footer' },
        h('span', { class: 'btn pull-left', id: 'ffe-modal-close-btn' }, 'Close'),
    ));
}

/**
 * Module handling the UI integration for story downloads.
 * Acts as a Facade/Orchestrator, injecting the UI and delegating 
 * the actual download logic to specific strategies (FicHub or Native).
 */
export const StoryDownloader = {
    MODULE_NAME: 'story-downloader',

    /** Flag tracking if a download request is currently in progress. */
    isDownloading: false,

    /** Reference to the dropdown menu container element. */
    dropdown: null as HTMLElement | null,

    /** Reference to the main trigger button for the dropdown. */
    mainBtn: null as HTMLButtonElement | null,

    /** Reference to the modal element. */
    modal: null as HTMLElement | null,

    /** Controller to manage the lifecycle of document event listeners. 
     * Prevents memory leaks by aborting previous listeners on re-injection.
     */
    abortController: null as AbortController | null,

    /**
     * Initializes the downloader by looking for the profile header.
     * Uses the Core Delegate system to find the injection point.
     */
    init: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'init');
        ThemeManager.ensureComponentStyles();
        Core.onDomReady(() => {
            const header = Core.getElement(Elements.PROFILE_HEADER);
            if (header) {
                log('Header found. Proceeding to inject UI.');
                this.injectDropdown(header as HTMLElement);
                this.injectModal();
            } else {
                log('Profile header not found. Aborting initialization.');
            }
        });
    },

    /**
     * Injects the Bootstrap-style modal into the body.
     * This mimics the native FFN "Follow/Favorite" modal structure.
     */
    injectModal: function () {
        // Prevent duplicate injection
        if (document.getElementById('ffe-download-modal')) return;
        ThemeManager.ensureComponentStyles();

        const modal = _buildDownloadModal();
        document.body.appendChild(modal);
        this.modal = modal;
        if (this.modal instanceof HTMLElement) {
            markFfneUiRoot(this.modal);
        }

        // Bind manual close handlers
        const closeX = document.getElementById('ffe-modal-close-x');
        const closeBtn = document.getElementById('ffe-modal-close-btn');
        if (closeX) closeX.onclick = () => this.closeModal();
        if (closeBtn) closeBtn.onclick = () => this.closeModal();
    },

    /**
     * Injects the AO3-style download dropdown menu.
     * Attempts to place the button next to the "Follow/Fav" button for visual consistency.
     * @param parentGroup - The header container element where the dropdown should be injected.
     */
    injectDropdown: function (parentGroup: HTMLElement) {
        const log = Core.getLogger(this.MODULE_NAME, 'injectDropdown');
        ThemeManager.ensureComponentStyles();

        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();

        const container = markFfneUiRoot(document.createElement('div'));
        container.className = 'ffne-dl-container';

        this.mainBtn = document.createElement('button');
        this.mainBtn.type = 'button';
        this.mainBtn.className = 'btn';
        this.mainBtn.setAttribute('aria-haspopup', 'menu');
        this.mainBtn.setAttribute('aria-expanded', 'false');
        this.mainBtn.textContent = 'Download \u25be';
        this.mainBtn.onclick = (e) => {
            e.preventDefault();
            this.toggleDropdown();
        };

        const menu = document.createElement('ul');
        menu.className = 'ffne-dl-menu';
        menu.setAttribute('role', 'menu');
        this.dropdown = menu;

        const formats = [
            { label: 'EPUB 🔥', id: SupportedFormats.EPUB },
            { label: 'MOBI', id: SupportedFormats.MOBI },
            { label: 'PDF', id: SupportedFormats.PDF },
            { label: 'HTML', id: SupportedFormats.HTML }
        ];

        formats.forEach(fmt => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.setAttribute('role', 'menuitem');
            a.innerText = fmt.label;
            a.href = "#";
            a.onclick = (e) => {
                e.preventDefault();
                if (this.isDownloading) return;
                this.toggleDropdown(false);
                this.openDownloadModal(fmt.id);
            };
            li.appendChild(a);
            menu.appendChild(li);
        });

        container.appendChild(this.mainBtn);
        container.appendChild(menu);

        const followBtn = Core.getElement(Elements.FOLLOW_BUTTON_CONTAINER);

        if (followBtn && followBtn.parentNode === parentGroup && followBtn.nextSibling) {
            log('Injecting dropdown before Follow/Fav sibling.');
            parentGroup.insertBefore(container, followBtn.nextSibling);
        } else {
            log('Appending dropdown to parent group.');
            parentGroup.appendChild(container);
        }

        document.addEventListener('click', (e) => {
            if (container && !container.contains(e.target as Node)) this.toggleDropdown(false);
        }, { signal: this.abortController.signal });
    },

    /**
     * Toggles the visibility of the download menu.
     * @param force - Optional boolean to force show (true) or hide (false).
     */
    toggleDropdown: function (force?: boolean) {
        if (!this.dropdown) return;

        const inlineDisplay = this.dropdown.style.display;
        const computedDisplay = window.getComputedStyle(this.dropdown).display;
        const isVisible = inlineDisplay
            ? inlineDisplay !== 'none'
            : computedDisplay !== 'none';
        const shouldShow = force ?? !isVisible;

        this.dropdown.style.display = shouldShow ? 'block' : 'none';
        this.mainBtn?.setAttribute('aria-expanded', String(shouldShow));
    },

    /**
     * Opens the selection modal for the user to choose the download strategy.
     * @param formatId - The requested format.
     */
    openDownloadModal: function (formatId: SupportedFormats) {
        const log = Core.getLogger(this.MODULE_NAME, 'openDownloadModal');

        if (!document.getElementById('ffe-download-modal')) {
            this.injectModal();
        }

        const m = document.getElementById('ffe-download-modal');
        const nativeBtn = document.getElementById('ffe-btn-native') as HTMLButtonElement;
        const fichubBtn = document.getElementById('ffe-btn-fichub') as HTMLButtonElement;
        const title = document.getElementById('ffe-modal-title');

        if (!m || !nativeBtn || !fichubBtn) {
            log('Error: Modal elements not found.');
            return;
        }

        if (title) title.innerText = `Download ${formatId.toUpperCase()}`;

        const replaceElement = (el: HTMLElement) => {
            const newEl = el.cloneNode(true) as HTMLElement;
            el.parentNode?.replaceChild(newEl, el);
            return newEl;
        };

        const freshNativeBtn = replaceElement(nativeBtn) as HTMLButtonElement;
        const freshFichubBtn = replaceElement(fichubBtn) as HTMLButtonElement;

        if (formatId === SupportedFormats.EPUB) {
            freshNativeBtn.style.display = 'inline-block';
            freshNativeBtn.onclick = () => {
                this.closeModal();
                this.processDownload(formatId, 'native');
            };
        } else {
            freshNativeBtn.style.display = 'none';
        }

        freshFichubBtn.onclick = () => {
            this.closeModal();
            this.processDownload(formatId, 'fichub');
        };

        // Show modal
        m.classList.remove('hide');
        m.style.display = 'block';
        // Force reflow so CSS transition (top: -25% → 10%, opacity: 0 → 1) plays
        void m.offsetHeight;
        m.classList.add('in');

        // Backdrop (Bootstrap 2.x style)
        if (!document.getElementById('ffe-modal-backdrop')) {
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop fade';
            backdrop.id = 'ffe-modal-backdrop';
            markFfneUiRoot(backdrop);
            document.body.appendChild(backdrop);
            void backdrop.offsetHeight;
            backdrop.classList.add('in');
        }
    },

    /**
     * Closes the modal and shifts focus back to the trigger button.
     */
    closeModal: function () {
        const m = document.getElementById('ffe-download-modal');
        if (!m) return;

        // Shift focus back to the page trigger immediately to avoid focus-loss issues
        if (this.mainBtn) {
            this.mainBtn.focus();
        } else {
            document.body.focus();
        }

        m.classList.remove('in');
        m.classList.add('hide');
        m.style.display = 'none';

        // Remove backdrop with fade-out
        const backdrop = document.getElementById('ffe-modal-backdrop');
        if (backdrop) {
            backdrop.classList.remove('in');
            setTimeout(() => backdrop.remove(), 150);
        }
    },

    /**
     * Executes the download task based on the user's selection from the Modal.
     */
    processDownload: async function (formatId: SupportedFormats, strategy: 'native' | 'fichub') {
        const log = Core.getLogger(this.MODULE_NAME, 'processDownload');

        if (!this.mainBtn) return;
        this.mainBtn.disabled = true;
        this.isDownloading = true;
        this.mainBtn.textContent = 'Processing...';

        let storyUrl = window.location.href.split('?')[0];

        if (storyUrl.includes('fanfiction.net')) {
            storyUrl = storyUrl.replace(/\/s\/(\d+)\/\d+/, '/s/$1/1');
        }

        const progressCallback = (msg: string) => {
            if (this.mainBtn) {
                this.mainBtn.innerText = msg;
            }
        };

        try {
            if (strategy === 'native') {
                await this.runNativeStrategy(formatId, storyUrl, progressCallback);
            } else {
                await this.runFicHubStrategy(formatId, storyUrl, progressCallback);
            }
        } catch (e) {
            log('Download strategy failed.', e);
            this.mainBtn.textContent = 'Error';
            alert("Download failed. Please try again later.");
        } finally {
            this.resetButton();
        }
    },

    /**
     * Helper to execute the FicHub strategy.
     */
    runFicHubStrategy: async function (formatId: SupportedFormats, url: string, cb: CallableFunction) {
        const log = Core.getLogger(this.MODULE_NAME, 'runFicHubStrategy');
        try {
            switch (formatId) {
                case SupportedFormats.EPUB: await FicHubDownloader.downloadAsEPUB(url, cb); break;
                case SupportedFormats.MOBI: await FicHubDownloader.downloadAsMOBI(url, cb); break;
                case SupportedFormats.PDF: await FicHubDownloader.downloadAsPDF(url, cb); break;
                case SupportedFormats.HTML: await FicHubDownloader.downloadAsHTML(url, cb); break;
                default: throw new Error(`Unsupported format: ${formatId}`);
            }
        } catch (e) {
            log("FicHub Strategy failed or returned error.", e);

            if (formatId !== SupportedFormats.EPUB) {
                alert("FicHub is currently unreachable for this format.\n\nPlease select 'EPUB' and choose the 'Native' option to generate a fresh copy directly.");
                throw e;
            } else {
                if (confirm("FicHub download failed. Would you like to try the Native Downloader instead?\n\n(This will scrape the story directly from the page.)")) {
                    await this.runNativeStrategy(SupportedFormats.EPUB, url, cb);
                    return;
                } else {
                    throw e;
                }
            }
        }
    },

    /**
     * Helper to execute the Native strategy.
     */
    runNativeStrategy: async function (formatId: SupportedFormats, url: string, cb: CallableFunction) {
        switch (formatId) {
            case SupportedFormats.EPUB: await NativeDownloader.downloadAsEPUB(url, cb); break;
            case SupportedFormats.MOBI: await NativeDownloader.downloadAsMOBI(url, cb); break;
            case SupportedFormats.PDF: await NativeDownloader.downloadAsPDF(url, cb); break;
            case SupportedFormats.HTML: await NativeDownloader.downloadAsHTML(url, cb); break;
            default: throw new Error(`Unsupported format: ${formatId}`);
        }
    },

    /**
     * Resets the main download button state after a delay.
     * @param immediate - If true, resets without the 3s delay.
     */
    resetButton: function (immediate?: boolean) {
        const reset = () => {
            if (this.mainBtn) {
                this.mainBtn.textContent = 'Download \u25be';
                this.mainBtn.disabled = false;
            }
            this.isDownloading = false;
        };

        if (immediate) {
            reset();
        } else {
            setTimeout(reset, 3000);
        }
    }
};
