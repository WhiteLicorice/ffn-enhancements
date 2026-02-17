// modules/LayoutManagerDelegate.ts

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

    // Currently relies on BaseDelegate defaults (returns null/empty).
    // If we need to fetch specific elements for layout logic later,
    // we implement getElement() here.
};