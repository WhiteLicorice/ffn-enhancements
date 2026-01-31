import { Elements } from '../enums/Elements';

/**
 * Delegate responsible for DOM retrieval on the Document Manager page (`/docs/docs.php`).
 * Handles the table structure and injection points for bulk operations.
 */
export const DocManagerDelegate = {

    /**
     * Primary retrieval method.
     * @param key - The Element Enum representing the UI component to fetch.
     */
    get(key: Elements): HTMLElement | HTMLElement[] | null {
        switch (key) {
            case Elements.DOC_TABLE:
                return document.querySelector('#gui_table1') as HTMLElement;

            case Elements.DOC_TABLE_HEAD_ROW:
                const table = document.querySelector('#gui_table1');
                if (!table) return null;
                return (table.querySelector('thead tr') || table.querySelector('tbody tr')) as HTMLElement;

            case Elements.DOC_TABLE_BODY_ROWS:
                const bodyTable = document.querySelector('#gui_table1');
                if (!bodyTable) return null;
                const rows = bodyTable.querySelectorAll('tbody tr');
                return Array.from(rows) as HTMLElement[];

            case Elements.DOC_MANAGER_LABEL:
                return this.findDocManagerLabel();

            case Elements.MAIN_CONTENT_WRAPPER:
                return document.querySelector('#content_wrapper_inner') as HTMLElement;

            default:
                return null;
        }
    },

    /**
     * Helper: Finds the "Document Manager" text node or label.
     * Used as an anchor point for injecting the "Download All" button.
     */
    findDocManagerLabel(): HTMLElement | null {
        const xpath = "//*[text()='Document Manager']";
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const textNode = result.singleNodeValue as HTMLElement; // logic already assumes this
        return textNode ? textNode.parentElement : null;
    }
};