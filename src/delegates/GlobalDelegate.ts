// delegates/GlobalDelegate.ts

import { Elements } from '../enums/Elements';
import { BaseDelegate } from './BaseDelegate';
import { IDelegate } from './IDelegate';

/**
 * Delegate responsible for DOM retrieval of site-wide elements.
 * Acts as a fallback for specific delegates.
 */
export const GlobalDelegate: IDelegate = {
    ...BaseDelegate,

    /**
     * Retrieves a single site-wide element.
     * @param key - The Element Enum representing the UI component to fetch.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns The DOM element corresponding to the key, or null if not found.
     */
    getElement(key: Elements, doc: Document = document): HTMLElement | null {
        switch (key) {
            case Elements.MAIN_CONTENT_WRAPPER:
                // FFN usually uses #content_wrapper_inner, but sometimes just #content_wrapper
                return (doc.querySelector('#content_wrapper_inner') ||
                    doc.querySelector('#content_wrapper')) as HTMLElement;
            case Elements.EDITOR_TEXT_AREA:
                // Used globally for all docs that have editable textareas (usually author-accessible pages only)
                return doc.querySelector("textarea[name='bio']") as HTMLElement;
            case Elements.EDITOR_TEXT_AREA_IFRAME:
                return doc.querySelector("#bio_ifr") as HTMLElement;
            case Elements.SAVE_BUTTON:
                return doc.querySelector("form[name='docform'] button[type='submit']") as HTMLElement;
            case Elements.DOC_FORM:
                return doc.querySelector("form[name='docform']") as HTMLFormElement
            default:
                return null;
        }
    },
};