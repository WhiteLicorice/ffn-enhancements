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

    /** * Controller to manage the lifecycle of document event listeners. 
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
            } else {
                log('Profile header not found. Aborting initialization.');
            }
        });
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
                this.processDownload(fmt.id);
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
     * Delegates the download task to the appropriate Strategy via explicit methods.
     * Handles UI state and Fallback Logic (FicHub -> Native).
     * @param formatId - The internal ID of the format (epub, mobi, pdf, html).
     */
    processDownload: async function (formatId: SupportedFormats) {
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

        // Track if we should skip the 3s timeout (e.g., user cancelled)
        let resetImmediately = false;

        try {
            // --- CASE A: EPUB (Dual Strategy Support) ---
            if (formatId === SupportedFormats.EPUB) {
                const useNative = confirm(
                    "Select EPUB Download Strategy:\n\n" +
                    "[OK] - Native (Slower, but guaranteed fresh from this page)\n" +
                    "[Cancel] - FicHub (Faster, but uses external cache, which may be stale)"
                );

                if (useNative) {
                    await this.runNativeStrategy(formatId, storyUrl, progressCallback);
                } else {
                    await this.runFicHubStrategy(formatId, storyUrl, progressCallback);
                }
            }

            // --- CASE B: MOBI, PDF, HTML (FicHub Only) ---
            else {
                const proceed = confirm(
                    `FicHub provides ${formatId.toUpperCase()} files via an external cache.\n` +
                    `If the story was updated very recently, the file might be stale.\n\n` +
                    `Proceed with download?`
                );

                if (proceed) {
                    await this.runFicHubStrategy(formatId, storyUrl, progressCallback);
                } else {
                    // User Cancelled: Reset button immediately (don't wait 3s)
                    resetImmediately = true;
                    return;
                }
            }

        } catch (e) {
            log('Download strategy failed.', e);
            this.mainBtn.innerHTML = "Error";
            alert("Download failed. Please try again later.");
        } finally {
            this.resetButton(resetImmediately);
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