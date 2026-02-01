// delegates/DocEditorDelegate.ts

import { Elements } from '../enums/Elements';
import { BaseDelegate } from './BaseDelegate';
import { IDelegate } from './IDelegate';

/**
 * Delegate responsible for DOM retrieval on the Document Editor page (`/docs/edit.php`).
 * Handles TinyMCE toolbars, title inputs, and header text.
 */
export const DocEditorDelegate: IDelegate = {
    ...BaseDelegate,

    /**
     * Primary retrieval method for single elements.
     * @param key - The Element Enum representing the UI component to fetch.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns The DOM element corresponding to the key, or null if not found.
     */
    getElement(key: Elements, doc:Document=document): HTMLElement | null {
        switch (key) {
            case Elements.EDITOR_TOOLBAR:
                // The TinyMCE toolbar often has a generated ID like 'mceu_15-body'.
                // We might need a more robust selector if this ID changes dynamically.
                return doc.querySelector('#mceu_15-body');

            case Elements.EDITOR_HEADER_LABEL:
                // The header usually looks like "Edit Document: Title - WordCount"
                return doc.querySelector("div.tcat b");

            case Elements.EDITOR_TITLE_INPUT:
                return doc.querySelector("input[name='title']");

            default:
                return null;
        }
    },
};