// delegates/StoryDelegate.ts

import { Elements } from '../enums/Elements';
import { IDelegate } from './IDelegate';

/**
 * Delegate responsible for DOM retrieval on Story Reading pages (`/s/*`).
 */
export const StoryDelegate: IDelegate = {

    /**
     * Primary retrieval method for single elements.
     * @param key - The Element Enum representing the UI component to fetch.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns The DOM element corresponding to the key, or null if not found.
     */
    getElement(key: Elements, doc:Document=document): HTMLElement | null {
        switch (key) {
            // --- Core Content ---
            case Elements.STORY_TEXT:
                return doc.querySelector('#storytext');

            // --- Navigation ---
            case Elements.NEXT_CHAPTER_BTN:
                return getButtonByText("Next >");

            case Elements.PREV_CHAPTER_BTN:
                return getButtonByText("< Prev");

            // --- Header / Metadata ---
            case Elements.PROFILE_HEADER:
                // The main header block containing title, author, and stats
                return doc.querySelector('#profile_top');

            case Elements.FOLLOW_BUTTON_CONTAINER:
                // The "Follow/Fav" buttons are usually generic buttons floated right inside the header.
                // We target them to inject the Download button next to them.
                return doc.querySelector('#profile_top button.pull-right');

            case Elements.REVIEW_BOX:
                return doc.querySelector('#review_review');

            default:
                return null;
        }
    },

    /**
     * Retrieval method for collections.
     * Currently, the Story page does not require fetching lists of elements.
     * @param _key - The Element Enum key (unused in this delegate).
     * @param _doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns An empty array to satisfy the IDelegate contract.
     */
    getElements(_key: Elements, _doc:Document=document): HTMLElement[] {
        // No collections currently mapped for Story view
        return [];
    }
};

/**
 * Helper: FFN does not use IDs for navigation buttons.
 * We must search for buttons containing specific text.
 * @param text - The text content to search for inside button elements.
 * @param doc - A document override if the delegate is supposed to be fetching from another window.
 * @returns The matching button element or null.
 */
function getButtonByText(text: string, doc:Document=document): HTMLElement | null {
    const buttons = doc.getElementsByTagName('button');
    for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].textContent?.includes(text)) {
            return buttons[i];
        }
    }
    return null;
}