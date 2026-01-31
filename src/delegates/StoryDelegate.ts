import { Elements } from '../enums/Elements';

/**
 * Delegate responsible for DOM retrieval on Story Reading pages (`/s/*`).
 * Handles the specific idiosyncrasies of FFN's legacy HTML structure for readers.
 */
export const StoryDelegate = {

    /**
     * Primary retrieval method.
     * @param key - The Element Enum representing the UI component to fetch.
     */
    get(key: Elements): HTMLElement | null {
        switch (key) {
            // --- Core Content ---
            case Elements.STORY_TEXT:
                return document.querySelector('#storytext');

            // --- Navigation ---
            case Elements.NEXT_CHAPTER_BTN:
                return this.getButtonByText("Next >");

            case Elements.PREV_CHAPTER_BTN:
                return this.getButtonByText("< Prev");

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
     * Helper: FFN does not use IDs for navigation buttons.
     * We must search for buttons containing specific text.
     */
    getButtonByText(text: string): HTMLElement | null {
        // We use getElementsByTagName for slightly better performance than querySelectorAll
        const buttons = document.getElementsByTagName('button');

        for (let i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent?.includes(text)) {
                return buttons[i];
            }
        }
        return null;
    }
};