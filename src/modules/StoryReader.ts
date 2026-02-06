// modules/StoryReader.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';

/**
 * Module responsible for UX enhancements on Story pages (`/s/*`).
 * Handles unlocking text selection and enabling hotkey navigation.
 */
export const StoryReader = {
    /**
     * Initializes the module logic.
     * Waits for the DOM to be ready before applying enhancements.
     */
    init: function () {
        const log = Core.getLogger('story-reader', 'init');
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
        const log = Core.getLogger('story-reader', 'enableSelectableText');

        const style = document.createElement('style');
        style.innerHTML = `
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
     * Fixes a native FFN bug where the cover art modal fails to display the image.
     * Manually handles the backdrop, image source swapping, and centering to 
     * ensure it works even when FFN's native jQuery plugins fail.
     */
    fixCoverArtModal: function () {
        const log = Core.getLogger('story-reader', 'fixCoverArtModal');

        // Find the specific span trigger and the modal container
        const trigger = document.querySelector('#profile_top span[onclick*="img_large"]');
        const modal = document.getElementById('img_large');

        if (!trigger || !modal) {
            log('Cover art trigger or modal not found. Skipping fix.');
            return;
        }

        // Re-parent the modal to the body to prevent overflow clipping
        if (modal.parentNode !== document.body) {
            document.body.appendChild(modal);
        }

        /**
         * Cleans the modal of all FFN transition classes and forces visibility.
         */
        const applyVisibleStyles = (show: boolean) => {
            if (show) {
                modal.classList.remove('hide', 'fade');
                modal.style.cssText = `
                    display: block !important;
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    transform: translate(-50%, -50%) !important;
                    z-index: 10000 !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                    background: white !important;
                    padding: 10px !important;
                    border-radius: 4px !important;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.5) !important;
                    width: auto !important;
                    height: auto !important;
                `;

                // Ensure the inner body and image are also forced visible
                const modalBody = modal.querySelector('.modal-body') as HTMLElement;
                if (modalBody) {
                    modalBody.style.cssText = 'display: block !important; padding: 0 !important; overflow: visible !important;';
                }
            } else {
                modal.style.display = 'none';
            }
        };

        // Initialize hidden state
        applyVisibleStyles(false);

        // Replace the buggy inline onclick with a robust manual handler
        (trigger as HTMLElement).onclick = (e: MouseEvent) => {
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
                    img.style.cssText = 'display: block !important; opacity: 1 !important; visibility: visible !important; max-width: 90vw; max-height: 90vh;';
                    log('Image source updated.');
                }
            }

            // 2. Handle Backdrop
            let backdrop = document.querySelector('.ffe-modal-backdrop') as HTMLElement;
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'ffe-modal-backdrop';
                backdrop.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background: rgba(0, 0, 0, 0.8);
                    z-index: 9999;
                `;
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
        const log = Core.getLogger('story-reader', 'enableKeyboardNav');

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
                window.scrollBy({ top: -300, behavior: 'smooth' });
            }
            else if (e.key.toLowerCase() === 's' || e.key === 'ArrowDown') {
                log('Scrolling Down');
                window.scrollBy({ top: 300, behavior: 'smooth' });
            }
        });

        log('Keyboard navigation listeners attached.');
    }
};