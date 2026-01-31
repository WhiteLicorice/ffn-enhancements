// delegates/IDelegate.ts

import { Elements } from "../enums/Elements";

/**
 * Interface defining the contract for Page Delegates.
 * Splits retrieval into explicit Singular and Collection methods to ensure type safety.
 */
export interface IDelegate {
    /**
     * Retrieves a single DOM element.
     * @returns The element or null if not found.
     */
    getElement(key: Elements): HTMLElement | null;

    /**
     * Retrieves a collection of DOM elements.
     * @returns An array of elements (empty if none found).
     */
    getElements(key: Elements): HTMLElement[];
}