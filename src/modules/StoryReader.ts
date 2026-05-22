// modules/StoryReader.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';
import { SettingsManager } from './SettingsManager';
import { markFfneUiRoot } from '../utils/ffneUi';

/**
 * Module responsible for UX enhancements on Story pages (`/s/*`).
 * Handles unlocking text selection and enabling hotkey navigation.
 */
export const StoryReader = {
    MODULE_NAME: 'story-reader',

    /**
     * Initializes the module logic.
     * Waits for the DOM to be ready before applying enhancements.
     */
    init: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'init');
        Core.onDomReady(() => {
            log('Initializing UX Enhancements...');
            this.enableSelectableText();
            this.enableKeyboardNav();
            this.fixCoverArtModal();
        });
    },

    /**
     * Injects CSS to force text selection, bypassing FFN's copy blocks.
     * Also replaces the story text node with a clone to strip inline event listeners (like oncopy/onselectstart).
     */
    enableSelectableText: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'enableSelectableText');

        const style = document.createElement('style');
        style.textContent = `
            #storytext, .storytext, p {
                -webkit-user-select: text !important;
                user-select: text !important;
            }
        `;
        document.head.appendChild(style);
        log('Selection CSS injected.');

        const storyText = Core.getElement(Elements.STORY_TEXT);
        if (storyText) {
            // Cloning the node removes event listeners attached via JS, effectively neutralizing anti-copy scripts
            const clone = storyText.cloneNode(true);
            storyText.parentNode?.replaceChild(clone, storyText);
            log('Text selection blocking removed (Event Listeners stripped via clone).');
        } else {
            log('Story text container not found.');
        }
    },

    /**
     * Fixes native FFN bug where cover art modal fails to display image.
     *
     * Expected FFN DOM structure (assumed by this fix):
     *   - Trigger: `#profile_top span[onclick*="img_large"]` — inline onclick
     *     calls `img_large(...)` with image path. No modern event listener.
     *   - Modal: `div#img_large.modal.hide.fade` — Bootstrap 2 modal container.
     *   - Inner: `div.modal-body > img[data-original]` — lazy-loaded cover art;
     *     `data-original` holds high-res URL, `src` holds thumbnail.
     *
     * FFN's own jQuery-based modal.show() breaks because TinyMCE or other
     * script conflicts prevent the Bootstrap plugin from transitioning the
     * image correctly. This fix bypasses FFN's handler entirely and manually
     * positions the modal, swaps the high-res image, and manages a backdrop.
     *
     * If expected structure missing — bails out early with log. No broken UI.
     */
    fixCoverArtModal: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'fixCoverArtModal');

        // Step 1: Locate trigger + modal by FFN-specific selectors
        const trigger = document.querySelector('#profile_top span[onclick*="img_large"]');
        const modal = document.getElementById('img_large');

        if (!trigger || !modal) {
            log('Cover art trigger or modal not found. Skipping fix.');
            return;
        }

        // Step 2: Validate expected internal structure before applying fix
        const img = modal.querySelector('img') as HTMLImageElement | null;
        if (!img) {
            log('Modal has no <img>. Unexpected structure. Skipping fix.');
            return;
        }
        // data-original holds high-res URL; without it we cannot swap
        if (!img.getAttribute('data-original')) {
            log('Cover <img> missing data-original attribute. Skipping fix.');
            return;
        }

        // Re-parent the modal to the body to prevent overflow clipping
        if (modal.parentNode !== document.body) {
            document.body.appendChild(modal);
        }
        markFfneUiRoot(modal);

        /**
         * Cleans the modal of all FFN transition classes and forces visibility.
         */
        const applyVisibleStyles = (show: boolean) => {
            if (show) {
                modal.classList.remove('hide', 'fade');
                modal.classList.add('ffne-cover-modal');
                modal.style.display = 'block';

                // Ensure the inner body and image are also forced visible
                const modalBody = modal.querySelector('.modal-body') as HTMLElement;
                if (modalBody) {
                    modalBody.classList.add('ffne-cover-modal-body');
                }
            } else {
                modal.style.display = 'none';
            }
        };

        // Initialize hidden state
        applyVisibleStyles(false);

        // Clone and replace trigger to strip existing jQuery/JS event listeners
        const triggerEl = trigger as HTMLElement;
        const triggerClone = triggerEl.cloneNode(true) as HTMLElement;
        triggerEl.parentNode?.replaceChild(triggerClone, triggerEl);

        // Assign manual handler on clone
        triggerClone.onclick = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            log('Triggering manual cover art modal.');

            // 1. Swap image to the high-res variant and force it to be visible
            const img = modal.querySelector('img') as HTMLImageElement | null;
            if (img) {
                const originalSrc = img.getAttribute('data-original');
                if (originalSrc) {
                    img.src = originalSrc;
                    img.className = 'cimage'; // Strips 'lazy'
                    img.classList.add('ffne-cover-img');
                    log('Image source updated.');
                }
            }

            // 2. Handle Backdrop
            let backdrop = document.querySelector('.ffe-modal-backdrop') as HTMLElement;
            if (!backdrop) {
                backdrop = markFfneUiRoot(document.createElement('div'));
                backdrop.className = 'ffe-modal-backdrop ffne-cover-backdrop';
                document.body.appendChild(backdrop);
            }
            backdrop.style.display = 'block';

            // 3. Show the Modal
            applyVisibleStyles(true);

            // 4. Close logic
            const closeModal = () => {
                applyVisibleStyles(false);
                backdrop.style.display = 'none';
                backdrop.removeEventListener('click', closeModal);
            };

            backdrop.addEventListener('click', closeModal);

            // Allow clicking the image itself or modal to close as well (common UX)
            modal.onclick = closeModal;
        };
    },

    /**
     * Attaches event listeners for keyboard shortcuts (Arrow keys, WASD).
     * Mapped keys:
     * - Right Arrow / D: Next Chapter
     * - Left Arrow / A: Previous Chapter
     * - Up Arrow / W: Scroll Up
     * - Down Arrow / S: Scroll Down
     */
    enableKeyboardNav: function () {
        const log = Core.getLogger(this.MODULE_NAME, 'enableKeyboardNav');

        document.addEventListener('keydown', (e) => {
            const target = e.target as HTMLElement;

            // Check if user is typing in an input or the review box
            const reviewBox = Core.getElement(Elements.REVIEW_BOX);
            if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable || target === reviewBox) return;

            // TODO: Utilize a Command design pattern so we can change keybinds here.
            if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
                const nextBtn = Core.getElement(Elements.NEXT_CHAPTER_BTN);
                if (nextBtn) {
                    log('Triggering Next Chapter');
                    nextBtn.click();
                }
            }
            else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
                const prevBtn = Core.getElement(Elements.PREV_CHAPTER_BTN);
                if (prevBtn) {
                    log('Triggering Previous Chapter');
                    prevBtn.click();
                }
            }
            else if (e.key.toLowerCase() === 'w' || e.key === 'ArrowUp') {
                log('Scrolling Up');
                window.scrollBy({ top: -SettingsManager.get('scrollStep'), behavior: 'smooth' });
            }
            else if (e.key.toLowerCase() === 's' || e.key === 'ArrowDown') {
                log('Scrolling Down');
                window.scrollBy({ top: SettingsManager.get('scrollStep'), behavior: 'smooth' });
            }
        });

        log('Keyboard navigation listeners attached.');
    }
};
