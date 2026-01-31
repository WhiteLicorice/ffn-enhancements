// delegates/StoryDelegate.ts

import { Elements } from '../enums/Elements';
import { IDelegate } from './IDelegate';

/**
 * Delegate responsible for DOM retrieval on Story Reading pages (`/s/*`).
 */
export const StoryDelegate: IDelegate = {

    /**
     * Primary retrieval method for single elements.
     */
    getElement(key: Elements): HTMLElement | null {
        switch (key) {
            // --- Core Content ---
            case Elements.STORY_TEXT:
                return document.querySelector('#storytext');

            // --- Navigation ---
            case Elements.NEXT_CHAPTER_BTN:
                return getButtonByText("Next >");

            case Elements.PREV_CHAPTER_BTN:
                return getButtonByText("< Prev");

            // --- Header / Metadata ---
            case Elements.PROFILE_HEADER:
                // The main header block containing title, author, and stats
                return document.querySelector('#profile_top');

            case Elements.FOLLOW_BUTTON_CONTAINER:
                // The "Follow/Fav" buttons are usually generic buttons floated right inside the header.
                // We target them to inject the Download button next to them.
                return document.querySelector('#profile_top button.pull-right');

            case Elements.REVIEW_BOX:
                return document.querySelector('#review_review');

            default:
                return null;
        }
    },

    /**
     * Retrieval method for collections.
     */
    getElements(key: Elements): HTMLElement[] {
        // No collections currently mapped for Story view
        return [];
    }
};

/**
 * Helper: FFN does not use IDs for navigation buttons.
 * We must search for buttons containing specific text.
 */
function getButtonByText(text: string): HTMLElement | null {
    const buttons = document.getElementsByTagName('button');
    for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].textContent?.includes(text)) {
            return buttons[i];
        }
    }
    return null;
}