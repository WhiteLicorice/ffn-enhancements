// modules/StoryDownloader.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import { GM_xmlhttpRequest } from '$';

/**
 * Module handling the integration with Fichub API for story downloads.
 * Injects a dropdown menu into the story header to allow downloading as EPUB, MOBI, PDF, or HTML.
 */
export const StoryDownloader = {
    /** Flag tracking if a download request is currently in progress. */
    isDownloading: false,

    /** Reference to the dropdown menu container element. */
    dropdown: null as HTMLElement | null,

    /** Reference to the main trigger button for the dropdown. */
    mainBtn: null as HTMLButtonElement | null,

    /**
     * Initializes the downloader by looking for the profile header.
     * Uses the Core Delegate system to find the injection point.
     */
    init: function () {
        Core.onDomReady(() => {
            const header = Core.getElement(Elements.PROFILE_HEADER);
            if (header) this.injectDropdown(header as HTMLElement);
        });
    },

    /**
     * Injects the AO3-style download dropdown menu.
     * attempts to place the button next to the "Follow/Fav" button for visual consistency.
     * @param parentGroup - The header container element where the dropdown should be injected.
     */
    injectDropdown: function (parentGroup: HTMLElement) {
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

        const formats = [{ l: 'EPUB', e: 'epub' }, { l: 'MOBI', e: 'mobi' }, { l: 'PDF', e: 'pdf' }, { l: 'HTML', e: 'html' }];
        formats.forEach(fmt => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.innerText = fmt.l;
            a.href = "#";
            a.style.cssText = "display: block; padding: 3px 20px; color: #333; text-decoration: none;";
            a.onclick = (e) => {
                e.preventDefault();
                if (this.isDownloading) return;
                this.toggleDropdown(false);
                this.processDownload(fmt.e);
            };
            li.appendChild(a);
            menu.appendChild(li);
        });

        container.appendChild(this.mainBtn);
        container.appendChild(menu);

        const followBtn = Core.getElement(Elements.FOLLOW_BUTTON_CONTAINER);

        if (followBtn && followBtn.parentNode === parentGroup && followBtn.nextSibling) {
            parentGroup.insertBefore(container, followBtn.nextSibling);
        } else {
            parentGroup.appendChild(container);
        }

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target as Node)) this.toggleDropdown(false);
        });
    },

    /**
     * Toggles the visibility of the download menu.
     * @param force - Optional boolean to force show (true) or hide (false).
     */
    toggleDropdown: function (force?: boolean) {
        if (this.dropdown) this.dropdown.style.display = (force ?? this.dropdown.style.display === 'none') ? 'block' : 'none';
    },

    /**
     * Sends a request to Fichub to retrieve the download URL for the specific format.
     * Uses GM_xmlhttpRequest to bypass CORS restrictions.
     * @param format - The file format (epub, mobi, pdf, html).
     */
    processDownload: function (format: string) {
        if (!this.mainBtn) return;
        this.mainBtn.disabled = true;
        this.isDownloading = true;

        const storyUrl = window.location.href.split('?')[0];
        const apiUrl = `https://fichub.net/api/v0/epub?q=${encodeURIComponent(storyUrl)}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: apiUrl,
            headers: { "User-Agent": "FFN-Enhancements" },
            // Explicitly type the 'res' parameter so the alias doesn't error out
            onload: (res: { status: number; responseText: string }) => {
                if (res.status === 429) return alert("Fichub Server Busy.");
                try {
                    const data = JSON.parse(res.responseText);
                    const rel = data.urls?.[format] || data[format + '_url'];
                    if (rel) window.location.href = "https://fichub.net" + rel;
                } catch (e) { Core.log('story-reader', 'Fichub', 'JSON Error', e); }
                this.resetButton();
            },
            onerror: () => this.resetButton()
        });
    },

    /**
     * Resets the main download button state after a delay.
     * Re-enables the button and clears the downloading flag.
     */
    resetButton: function () {
        setTimeout(() => {
            if (this.mainBtn) {
                this.mainBtn.innerHTML = "Download &#9662;";
                this.mainBtn.disabled = false;
            }
            this.isDownloading = false;
        }, 3000);
    }
};