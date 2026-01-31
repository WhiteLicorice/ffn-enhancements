// delegates/DocEditorDelegate.ts

import { Elements } from '../enums/Elements';
import { IDelegate } from './IDelegate';

/**
 * Delegate responsible for DOM retrieval on the Document Editor page (`/docs/edit.php`).
 * Handles TinyMCE toolbars, title inputs, and header text.
 */
export const DocEditorDelegate: IDelegate = {

    /**
     * Primary retrieval method for single elements.
     * @param key - The Element Enum representing the UI component to fetch.
     * @returns The DOM element corresponding to the key, or null if not found.
     */
    getElement(key: Elements): HTMLElement | null {
        switch (key) {
            case Elements.EDITOR_TOOLBAR:
                // The TinyMCE toolbar often has a generated ID like 'mceu_15-body'.
                // We might need a more robust selector if this ID changes dynamically.
                return document.querySelector('#mceu_15-body');

            case Elements.EDITOR_HEADER_LABEL:
                // The header usually looks like "Edit Document: Title - WordCount"
                return document.querySelector("div.tcat b");

            case Elements.EDITOR_TITLE_INPUT:
                return document.querySelector("input[name='title']");

            case Elements.EDITOR_TEXT_AREA:
                // Fallback for when TinyMCE isn't fully loaded or we need raw access
                return document.querySelector("textarea[name='bio']") ||
                    document.querySelector("#story_text");

            default:
                return null;
        }
    },

    /**
     * Retrieves a collection of DOM elements.
     * Currently, the Editor page does not require fetching lists of elements.
     * @param key - The Element Enum key (unused in this delegate).
     * @returns An empty array to satisfy the IDelegate contract.
     */
    getElements(_key: Elements): HTMLElement[] {
        return [];
    }
};