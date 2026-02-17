// modules/LayoutManagerDelegate.ts

import { Elements } from '../enums/Elements';
import { BaseDelegate } from './BaseDelegate';
import { IDelegate } from './IDelegate';

/**
 * LayoutManagerDelegate
 * * A standard Delegate implementation for the Layout system.
 * Currently, the LayoutManager uses global CSS injection, so this delegate
 * acts as a standard DOM retriever if we need to fetch specific elements
 * for layout calculations in the future.
 */
export const LayoutManagerDelegate: IDelegate = {
    ...BaseDelegate,

    /**
     * Retrieves layout-specific elements.
     * @param key - The Element Enum.
     * @param doc - The document context.
     */
    getElement(key: Elements, doc: Document = document): HTMLElement | null {
        switch (key) {
            case Elements.STORY_WIDTH_CONTROL:
                return doc.querySelector('.icon-align-justify') as HTMLElement;
            default:
                return null;
        }
    }
};