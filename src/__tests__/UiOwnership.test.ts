import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportedFormats } from '../enums/SupportedFormats';
import { Ao3Bridge } from '../modules/Ao3Bridge';
import { Core } from '../modules/Core';
import { DocEditor } from '../modules/DocEditor';
import { StoryDownloader } from '../modules/StoryDownloader';
import { StoryReader } from '../modules/StoryReader';

describe('FFNE UI ownership markers', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        document.body.innerHTML = '';
        StoryDownloader.dropdown = null;
        StoryDownloader.mainBtn = null;
        StoryDownloader.modal = null;
        StoryDownloader.abortController = null;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.head.innerHTML = '';
        document.body.innerHTML = '';
    });

    it('marks story downloader roots as FFNE-owned UI', () => {
        vi.spyOn(Core, 'getElement').mockReturnValue(null);
        const header = document.createElement('div');
        document.body.appendChild(header);

        StoryDownloader.injectDropdown(header);
        StoryDownloader.injectModal();
        StoryDownloader.openDownloadModal(SupportedFormats.EPUB);

        expect(header.querySelector('.ffne-dl-container')?.getAttribute('data-ffne-ui')).toBe('');
        expect(document.getElementById('ffe-download-modal')?.getAttribute('data-ffne-ui')).toBe('');
        expect(document.getElementById('ffe-modal-backdrop')?.getAttribute('data-ffne-ui')).toBe('');
    });

    it('marks clipboard toasts and AO3 bridge panel as FFNE-owned UI', () => {
        DocEditor._showToast('Copied!', false);
        Ao3Bridge._injectPanel();

        expect(document.getElementById('ffne-clipboard-toast')?.getAttribute('data-ffne-ui')).toBe('');
        expect(document.getElementById('ffne-ao3-bridge-panel')?.getAttribute('data-ffne-ui')).toBe('');
    });

    it('marks the cover-art lightbox roots as FFNE-owned UI', () => {
        document.body.innerHTML = `
            <div id="profile_top">
                <span onclick="img_large()">Cover</span>
            </div>
            <div id="img_large" class="modal hide fade">
                <div class="modal-body">
                    <img src="thumb.jpg" data-original="large.jpg">
                </div>
            </div>
        `;

        StoryReader.fixCoverArtModal();

        const trigger = document.querySelector<HTMLElement>('#profile_top span');
        trigger?.click();

        expect(document.getElementById('img_large')?.getAttribute('data-ffne-ui')).toBe('');
        expect(document.querySelector('.ffne-cover-backdrop')?.getAttribute('data-ffne-ui')).toBe('');
    });
});
