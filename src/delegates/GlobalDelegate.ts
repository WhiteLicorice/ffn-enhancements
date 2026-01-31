import { Elements } from '../enums/Elements';

/**
 * Delegate responsible for DOM retrieval of site-wide elements.
 * Acts as a fallback for specific delegates.
 */
export const GlobalDelegate = {

    /**
     * Primary retrieval method.
     * @param key - The Element Enum representing the UI component to fetch.
     */
    get(key: Elements): HTMLElement | HTMLElement[] | null {
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
    }
};