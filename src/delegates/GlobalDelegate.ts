// delegates/GlobalDelegate.ts

import { Elements } from '../enums/Elements';
import { IDelegate } from './IDelegate';

/**
 * Delegate responsible for DOM retrieval of site-wide elements.
 * Acts as a fallback for specific delegates.
 */
export const GlobalDelegate: IDelegate = {

    /**
     * Retrieves a single site-wide element.
     * @param key - The Element Enum representing the UI component to fetch.
     * @returns The DOM element corresponding to the key, or null if not found.
     */
    getElement(key: Elements): HTMLElement | null {
        switch (key) {
            case Elements.MAIN_CONTENT_WRAPPER:
                // FFN usually uses #content_wrapper_inner, but sometimes just #content_wrapper
                return (document.querySelector('#content_wrapper_inner') ||
                    document.querySelector('#content_wrapper')) as HTMLElement;

            // If we eventually add support for the top navigation bar (Login/Signup/User),
            // it would go here.

            default:
                return null;
        }
    },

    /**
     * Retrieves site-wide collections.
     * Currently, there are no global collections needed.
     * @param _key - The Element Enum key (unused in this delegate).
     * @returns An empty array to satisfy the IDelegate contract.
     */
    getElements(_key: Elements): HTMLElement[] {
        // Currently, there are no global collections needed.
        return [];
    }
};