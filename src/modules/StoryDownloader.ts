import { Core } from './Core';
import { GM_xmlhttpRequest } from '$';

export const StoryDownloader = {
    isDownloading: false,
    dropdown: null as HTMLElement | null,
    mainBtn: null as HTMLButtonElement | null,

    init: function () {
        Core.onDomReady(() => {
            const header = document.querySelector('#profile_top');
            if (header) this.injectDropdown(header as HTMLElement);
        });
    },

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

        const followBtn = parentGroup.querySelector('button.pull-right');
        if (followBtn?.nextSibling) parentGroup.insertBefore(container, followBtn.nextSibling);
        else parentGroup.appendChild(container);

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target as Node)) this.toggleDropdown(false);
        });
    },

    toggleDropdown: function (force?: boolean) {
        if (this.dropdown) this.dropdown.style.display = (force ?? this.dropdown.style.display === 'none') ? 'block' : 'none';
    },

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
            onload: (res) => {
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