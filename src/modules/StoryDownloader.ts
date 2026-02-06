// modules/StoryDownloader.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import { FicHubDownloader } from './FicHubDownloader';
import { NativeDownloader } from './NativeDownloader';
import { SupportedFormats } from '../enums/SupportedFormats';

/**
 * Module handling the UI integration for story downloads.
 * Acts as a Facade/Orchestrator, injecting the UI and delegating 
 * the actual download logic to specific strategies (FicHub or Native).
 */
export const StoryDownloader = {
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
        const log = Core.getLogger('story-downloader', 'init');
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

        const modalHtml = `
            <div class="modal fade hide" id="ffe-download-modal" tabindex="-1" role="dialog" aria-hidden="true" style="display: none;">
                <div class="modal-header">
                    <button type="button" class="close" data-dismiss="modal" aria-hidden="true">×</button>
                    <h3 id="ffe-modal-title">Select Download Method</h3>
                </div>
                <div class="modal-body" style="text-align: center; min-height: 150px;">
                    <p style="margin-bottom: 20px;">Choose a source for your file:</p>
                    
                    <div style="display: flex; justify-content: center; gap: 20px; margin-bottom: 20px;">
                        <button id="ffe-btn-native" class="btn btn-primary icon-book" style="width: 140px; padding: 10px;">
                            Native<br><span style="font-size: 0.8em; font-weight: normal;">(Browser)</span>
                        </button>

                        <button id="ffe-btn-fichub" class="btn btn-primary icon-cloud-download" style="width: 140px; padding: 10px;">
                            FicHub<br><span style="font-size: 0.8em; font-weight: normal;">(Archive)</span>
                        </button>
                    </div>

                    <div class="alert alert-info" style="text-align: left; margin: 0 20px; font-size: 0.9em; min-height: 40px; display: flex; align-items: center;">
                        <span id="ffe-desc-text">Hover over an option to see details.</span>
                    </div>
                </div>
                <div class="modal-footer">
                    <span class="btn pull-left" data-dismiss="modal">Close</span>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.modal = document.getElementById('ffe-download-modal');

        // Bind hover effects for UX descriptions
        const nativeBtn = document.getElementById('ffe-btn-native');
        const fichubBtn = document.getElementById('ffe-btn-fichub');
        const descText = document.getElementById('ffe-desc-text');

        if (nativeBtn && descText) {
            nativeBtn.addEventListener('mouseenter', () => {
                descText.innerHTML = "<strong>Native:</strong> Generates the file directly from this page. Guaranteed to be the latest version, but takes longer.";
            });
            nativeBtn.addEventListener('mouseleave', () => {
                descText.innerHTML = "Hover over an option to see details.";
            });
        }

        if (fichubBtn && descText) {
            fichubBtn.addEventListener('mouseenter', () => {
                descText.innerHTML = "<strong>FicHub:</strong> Downloads from the FicHub archive. Very fast, but the file might be slightly older (cached).";
            });
            fichubBtn.addEventListener('mouseleave', () => {
                descText.innerHTML = "Hover over an option to see details.";
            });
        }
    },

    /**
     * Injects the AO3-style download dropdown menu.
     * Attempts to place the button next to the "Follow/Fav" button for visual consistency.
     * @param parentGroup - The header container element where the dropdown should be injected.
     */
    injectDropdown: function (parentGroup: HTMLElement) {
        const log = Core.getLogger('story-downloader', 'injectDropdown');

        // Clean up previous event listeners to prevent stacking/leaks
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();

        const container = document.createElement('div');
        container.style.cssText = "display: inline-block; position: relative; margin-right: 5px; vertical-align: top; float: right;";

        this.mainBtn = document.createElement('button');
        this.mainBtn.className = 'btn';
        this.mainBtn.innerHTML = "Download &#9662;";
        this.mainBtn.onclick = (e) => {
            e.preventDefault();
            this.toggleDropdown();
        };

        const menu = document.createElement('ul');
        menu.style.cssText = `
            display: none; position: absolute; top: 100%; right: 0; z-index: 1000;
            min-width: 100px; padding: 5px 0; margin: 2px 0 0;
            background-color: #fff; border: 1px solid rgba(0,0,0,0.15); border-radius: 4px;
            box-shadow: 0 6px 12px rgba(0,0,0,0.175); list-style: none; text-align: left;
        `;
        this.dropdown = menu;

        // Map labels to internal IDs used in processDownload switch
        const formats = [
            { label: 'EPUB 🔥', id: SupportedFormats.EPUB },
            { label: 'MOBI', id: SupportedFormats.MOBI },
            { label: 'PDF', id: SupportedFormats.PDF },
            { label: 'HTML', id: SupportedFormats.HTML }
        ];

        formats.forEach(fmt => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.innerText = fmt.label;
            a.href = "#";
            a.style.cssText = "display: block; padding: 3px 20px; color: #333; text-decoration: none;";
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

        // Attach listener with the AbortSignal to ensure cleanup
        document.addEventListener('click', (e) => {
            if (container && !container.contains(e.target as Node)) this.toggleDropdown(false);
        }, { signal: this.abortController.signal });
    },

    /**
     * Toggles the visibility of the download menu.
     * @param force - Optional boolean to force show (true) or hide (false).
     */
    toggleDropdown: function (force?: boolean) {
        if (this.dropdown) this.dropdown.style.display = (force ?? this.dropdown.style.display === 'none') ? 'block' : 'none';
    },

    /**
     * Opens the selection modal for the user to choose the download strategy.
     * Replaces previous confirm() logic.
     * @param formatId - The requested format.
     */
    openDownloadModal: function (formatId: SupportedFormats) {
        const log = Core.getLogger('story-downloader', 'openDownloadModal');

        // Ensure modal exists
        if (!document.getElementById('ffe-download-modal')) {
            this.injectModal();
        }

        const nativeBtn = document.getElementById('ffe-btn-native') as HTMLButtonElement;
        const fichubBtn = document.getElementById('ffe-btn-fichub') as HTMLButtonElement;
        const title = document.getElementById('ffe-modal-title');

        if (!nativeBtn || !fichubBtn) {
            log('Error: Modal elements not found.');
            return;
        }

        // Configure UI based on Format
        if (title) title.innerText = `Download ${formatId.toUpperCase()}`;

        // Remove old listeners to prevent stacking (cloning the node is the cleanest way without external refs)
        const replaceElement = (el: HTMLElement) => {
            const newEl = el.cloneNode(true) as HTMLElement;
            el.parentNode?.replaceChild(newEl, el);
            return newEl;
        };

        const freshNativeBtn = replaceElement(nativeBtn) as HTMLButtonElement;
        const freshFichubBtn = replaceElement(fichubBtn) as HTMLButtonElement;

        // Re-bind hover logic after cloning (since we wiped listeners)
        const descText = document.getElementById('ffe-desc-text');
        if (descText) {
            const bindHover = (btn: HTMLElement, text: string) => {
                btn.addEventListener('mouseenter', () => descText.innerHTML = text);
                btn.addEventListener('mouseleave', () => descText.innerHTML = "Hover over an option to see details.");
            };
            bindHover(freshNativeBtn, "<strong>Native:</strong> Generates the file directly from this page. Guaranteed to be the latest version, but takes longer.");
            bindHover(freshFichubBtn, "<strong>FicHub:</strong> Downloads from the FicHub archive. Very fast, but the file might be slightly older (cached).");
        }

        // Logic for EPUB (Dual Options)
        if (formatId === SupportedFormats.EPUB) {
            freshNativeBtn.style.display = 'inline-block';
            freshNativeBtn.onclick = () => {
                this.closeModal();
                this.processDownload(formatId, 'native');
            };
        } else {
            // Non-EPUB formats only support FicHub currently
            freshNativeBtn.style.display = 'none';
        }

        // Logic for FicHub (All formats)
        freshFichubBtn.onclick = () => {
            this.closeModal();
            this.processDownload(formatId, 'fichub');
        };

        // Try to trigger Bootstrap modal using Page jQuery (via unsafeWindow if available)
        // OR fallback to manual CSS toggling if we are in a strict sandbox.
        try {
            const jq = (window as any).$ || (window as any).jQuery || (window as any).unsafeWindow?.$ || (window as any).unsafeWindow?.jQuery;

            if (jq) {
                jq("#ffe-download-modal").modal('show');
            } else {
                // Fallback: Manually mimic Bootstrap 2 'Show' state
                const m = document.getElementById('ffe-download-modal');
                if (m) {
                    m.classList.remove('hide');
                    m.classList.add('in');
                    m.style.display = 'block';
                }
            }
        } catch (e) {
            log('Failed to trigger modal.', e);
        }
    },

    closeModal: function () {
        try {
            const jq = (window as any).$ || (window as any).jQuery || (window as any).unsafeWindow?.$ || (window as any).unsafeWindow?.jQuery;

            if (jq) {
                jq("#ffe-download-modal").modal('hide');
            } else {
                // Fallback: Manually mimic Bootstrap 2 'Hide' state
                const m = document.getElementById('ffe-download-modal');
                if (m) {
                    m.classList.remove('in');
                    m.classList.add('hide');
                    m.style.display = 'none';
                }
            }
        } catch (e) { /* ignore */ }
    },

    /**
     * Executes the download task based on the user's selection from the Modal.
     * @param formatId - The internal ID of the format.
     * @param strategy - 'native' or 'fichub'.
     */
    processDownload: async function (formatId: SupportedFormats, strategy: 'native' | 'fichub') {
        const log = Core.getLogger('story-downloader', 'processDownload');

        if (!this.mainBtn) return;
        this.mainBtn.disabled = true;
        this.isDownloading = true;
        this.mainBtn.innerHTML = "Processing...";

        // Extract ID and construct URL for metadata checking
        let storyUrl = window.location.href.split('?')[0];

        // Force Chapter 1 for canonical consistency
        if (storyUrl.includes('fanfiction.net')) {
            storyUrl = storyUrl.replace(/\/s\/(\d+)\/\d+/, '/s/$1/1');
        }

        // Define the progress callback that updates the button text
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
            this.mainBtn.innerHTML = "Error";
            alert("Download failed. Please try again later.");
        } finally {
            this.resetButton();
        }
    },

    /**
     * Helper to execute the FicHub strategy.
     * Includes detection for potential API failures/staleness.
     */
    runFicHubStrategy: async function (formatId: SupportedFormats, url: string, cb: CallableFunction) {
        const log = Core.getLogger('story-downloader', 'runFicHubStrategy');
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

            // User Guidance on Failed FicHub
            if (formatId !== SupportedFormats.EPUB) {
                alert("FicHub is currently unreachable for this format.\n\nPlease select 'EPUB' and choose the 'Native' option to generate a fresh copy directly.");
                throw e;
            } else {
                // If they were already trying EPUB via FicHub and it failed
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
     * Re-enables the button and clears the downloading flag.
     * @param immediate - If true, resets without the 3s delay.
     */
    resetButton: function (immediate?: boolean) {
        const reset = () => {
            if (this.mainBtn) {
                this.mainBtn.innerHTML = "Download &#9662;";
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