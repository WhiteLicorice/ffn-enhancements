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
     */
    getElements(_key: Elements): HTMLElement[] {
        // Currently, there are no global collections needed.
        return [];
    }
};