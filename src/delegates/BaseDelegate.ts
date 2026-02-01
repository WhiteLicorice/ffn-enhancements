// delegates/BaseDelegate.ts

import { Elements } from "../enums/Elements";
import { IDelegate } from "./IDelegate";

/**
 * A base implementation of the IDelegate interface.
 * Provides "No-Op" (No Operation) defaults for retrieval methods.
 * * Usage: Use the spread operator to inherit these defaults in specific delegates.
 * Example: const MyDelegate = { ...BaseDelegate, getElement: ... }
 */
export const BaseDelegate: IDelegate = {
    /**
     * Default implementation: Returns null.
     * Overridden by specific delegates to find actual elements.
     * @param _key - The Element Enum key.
     * @param _doc - The document context.
     */
    getElement: function (_key: Elements, _doc?: Document): HTMLElement | null {
        return null;
    },

    /**
     * Default implementation: Returns an empty array.
     * Use this fallback when a page does not have any list-based content (like tables).
     * @param _key - The Element Enum key.
     * @param _doc - The document context.
     */
    getElements: function (_key: Elements, _doc?: Document): HTMLElement[] {
        return [];
    }
};