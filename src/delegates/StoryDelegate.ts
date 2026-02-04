// delegates/StoryDelegate.ts

import { Elements } from '../enums/Elements';
import { BaseDelegate } from './BaseDelegate';
import { IDelegate } from './IDelegate';

/**
 * Delegate responsible for DOM retrieval on Story Reading pages (`/s/*`).
 */
export const StoryDelegate: IDelegate = {
    ...BaseDelegate,

    /**
     * Primary retrieval method for single elements.
     * @param key - The Element Enum representing the UI component to fetch.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns The DOM element corresponding to the key, or null if not found.
     */
    getElement(key: Elements, doc: Document = document): HTMLElement | null {
        switch (key) {
            // --- Core Content ---
            case Elements.STORY_TEXT:
                return doc.querySelector('#storytext');

            // --- Navigation ---
            case Elements.CHAPTER_DROPDOWN:
                return doc.getElementById('chap_select');

            case Elements.NEXT_CHAPTER_BTN:
                return getButtonByText("Next >", doc);

            case Elements.PREV_CHAPTER_BTN:
                return getButtonByText("< Prev", doc);

            // --- Header / Metadata ---
            case Elements.PROFILE_HEADER:
                // The main header block containing title, author, and stats
                return doc.querySelector('#profile_top');

            case Elements.STORY_TITLE:
                // Title is usually in a bold tag with xcontrast_txt class
                return doc.querySelector('#profile_top b.xcontrast_txt');

            case Elements.STORY_AUTHOR:
                // Author is a link with xcontrast_txt class
                return doc.querySelector('#profile_top a.xcontrast_txt');

            case Elements.STORY_SUMMARY:
                // Description is usually the div with xcontrast_txt class inside profile_top
                return doc.querySelector('#profile_top > div.xcontrast_txt');

            case Elements.STORY_COVER:
                // FFN usually marks the cover image with the class 'cimage' inside the profile header
                return doc.querySelector('#profile_top img.cimage');

            case Elements.FOLLOW_BUTTON_CONTAINER:
                // The "Follow/Fav" buttons are usually generic buttons floated right inside the header.
                // We target them to inject the Download button next to them.
                return doc.querySelector('#profile_top button.pull-right');

            case Elements.REVIEW_BOX:
                return doc.querySelector('#review_review');

            case Elements.STORY_META_BLOCK:
                // This is the span with class 'xgray' and 'xcontrast_txt' usually found at the bottom of profile_top.
                // It contains the "Rated: T - English - ..." text.
                return doc.querySelector('#profile_top > span.xgray.xcontrast_txt');

            default:
                return null;
        }
    },
};

/**
 * Helper: FFN does not use IDs for navigation buttons.
 * We must search for buttons containing specific text.
 * @param text - The text content to search for inside button elements.
 * @param doc - A document override if the delegate is supposed to be fetching from another window.
 * @returns The matching button element or null.
 */
function getButtonByText(text: string, doc: Document = document): HTMLElement | null {
    const buttons = doc.getElementsByTagName('button');
    for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].textContent?.includes(text)) {
            return buttons[i];
        }
    }
    return null;
}