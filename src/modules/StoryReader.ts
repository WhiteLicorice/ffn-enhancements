// modules/StoryReader.ts

import { Core } from './Core';
import { Elements } from '../enums/Elements';

/**
 * Module responsible for UX enhancements on Story pages (`/s/*`).
 */
export const StoryReader = {
    /**
     * Initializes the module logic.
     */
    init: function () {
        Core.onDomReady(() => {
            Core.log('story-reader', 'StoryReader', 'Initializing UX Enhancements...');
            this.enableSelectableText();
            this.enableKeyboardNav();
        });
    },

    /**
     * Injects CSS to force text selection, bypassing FFN's copy blocks.
     */
    enableSelectableText: function () {
        const style = document.createElement('style');
        style.innerHTML = `
            #storytext, .storytext, p {
                -webkit-user-select: text !important;
                user-select: text !important;
            }
        `;
        document.head.appendChild(style);

        const storyText = Core.getElement(Elements.STORY_TEXT);
        if (storyText) {
            const clone = storyText.cloneNode(true);
            storyText.parentNode?.replaceChild(clone, storyText);
            Core.log('story-reader', 'StoryReader', 'Text selection blocking removed.');
        }
    },

    /**
     * Attaches event listeners for keyboard shortcuts (Arrow keys, WASD).
     */
    enableKeyboardNav: function () {
        document.addEventListener('keydown', (e) => {
            const target = e.target as HTMLElement;

            // Check if user is typing in an input or the review box
            const reviewBox = Core.getElement(Elements.REVIEW_BOX);
            if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable || target === reviewBox) return;

            if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
                const nextBtn = Core.getElement(Elements.NEXT_CHAPTER_BTN);
                if (nextBtn) nextBtn.click();
            }
            else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
                const prevBtn = Core.getElement(Elements.PREV_CHAPTER_BTN);
                if (prevBtn) prevBtn.click();
            }
            else if (e.key.toLowerCase() === 'w' || e.key === 'ArrowUp') {
                window.scrollBy({ top: -300, behavior: 'smooth' });
            }
            else if (e.key.toLowerCase() === 's' || e.key === 'ArrowDown') {
                window.scrollBy({ top: 300, behavior: 'smooth' });
            }
        });
    }
};