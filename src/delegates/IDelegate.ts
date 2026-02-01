// delegates/IDelegate.ts

import { Elements } from "../enums/Elements";

/**
 * Interface defining the contract for Page Delegates.
 * Splits retrieval into explicit Singular and Collection methods to ensure type safety.
 */
export interface IDelegate {
    /**
     * Retrieves a single DOM element.
     * @param key - The Element Enum representing the UI component to fetch.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns The element or null if not found.
     */
    getElement(key: Elements, doc?: Document): HTMLElement | null;

    /**
     * Retrieves a collection of DOM elements.
     * @param key - The Element Enum representing the UI component to fetch.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns An array of elements (empty if none found).
     */
    getElements(key: Elements, doc?: Document): HTMLElement[];
}