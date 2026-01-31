import { Core } from './Core';

export const StoryReader = {
    init: function () {
        Core.onDomReady(() => {
            Core.log('story-reader', 'StoryReader', 'Initializing UX Enhancements...');
            this.enableSelectableText();
            this.enableKeyboardNav();
        });
    },

    enableSelectableText: function () {
        const style = document.createElement('style');
        style.innerHTML = `
            #storytext, .storytext, p {
                -webkit-user-select: text !important;
                user-select: text !important;
            }
        `;
        document.head.appendChild(style);

        const storyText = document.querySelector('#storytext');
        if (storyText) {
            const clone = storyText.cloneNode(true);
            storyText.parentNode?.replaceChild(clone, storyText);
            Core.log('story-reader', 'StoryReader', 'Text selection blocking removed.');
        }
    },

    enableKeyboardNav: function () {
        document.addEventListener('keydown', (e) => {
            const target = e.target as HTMLElement;
            if (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable || target.id === 'review_review') return;

            const btns = Array.from(document.querySelectorAll('button'));
            if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
                btns.find(b => b.textContent?.includes("Next >"))?.click();
            } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
                btns.find(b => b.textContent?.includes("< Prev"))?.click();
            } else if (e.key.toLowerCase() === 'w' || e.key === 'ArrowUp') {
                window.scrollBy({ top: -300, behavior: 'smooth' });
            } else if (e.key.toLowerCase() === 's' || e.key === 'ArrowDown') {
                window.scrollBy({ top: 300, behavior: 'smooth' });
            }
        });
    }
};