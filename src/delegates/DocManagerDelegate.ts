// delegates/DocManagerDelegate.ts

import { Elements } from '../enums/Elements';
import { BaseDelegate } from './BaseDelegate';
import { IDelegate } from './IDelegate';

/**
 * Delegate responsible for DOM retrieval on the Document Manager page (`/docs/docs.php`).
 * Handles the table structure and injection points for bulk operations.
 */
export const DocManagerDelegate: IDelegate = {
    ...BaseDelegate,
    
    /**
     * Retrieves single UI components.
     * @param key - The Element Enum representing the UI component to fetch.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns The DOM element corresponding to the key, or null if not found.
     */
    getElement(key: Elements, doc:Document=document): HTMLElement | null {
        switch (key) {
            case Elements.DOC_TABLE:
                return doc.querySelector('#gui_table1') as HTMLElement;

            case Elements.DOC_TABLE_HEAD_ROW:
                const table = doc.querySelector('#gui_table1');
                if (!table) return null;
                return (table.querySelector('thead tr') || table.querySelector('tbody tr')) as HTMLElement;

            case Elements.DOC_MANAGER_LABEL:
                return findDocManagerLabel();

            default:
                return null;
        }
    },

    /**
     * Retrieves lists of components (e.g., Table Rows).
     * @param key - The Element Enum representing the UI component to fetch.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns An array of DOM elements (empty if none found).
     */
    getElements(key: Elements, doc:Document=document): HTMLElement[] {
        switch (key) {
            case Elements.DOC_TABLE_BODY_ROWS:
                const bodyTable = doc.querySelector('#gui_table1');
                if (!bodyTable) return [];
                const rows = bodyTable.querySelectorAll('tbody tr');
                return Array.from(rows) as HTMLElement[];

            default:
                return [];
        }
    }
};

/**
 * Helper: Finds the "Document Manager" text node or label.
 * Used as an anchor point for injecting the "Download All" button.
 * @param doc - A document override if the delegate is supposed to be fetching from another window.
 */
function findDocManagerLabel(doc:Document=document): HTMLElement | null {
    const xpath = "//*[text()='Document Manager']";
    const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const textNode = result.singleNodeValue as HTMLElement;
    return textNode ? textNode.parentElement : null;
}