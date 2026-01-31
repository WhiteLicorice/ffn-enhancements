import { Elements } from "../enums/Elements";

/**
 * Interface defining the contract for Page Delegates.
 * Each Delegate must know how to retrieve Elements for its specific page type.
 */
export interface IDelegate {
    get(key: Elements): HTMLElement | HTMLElement[] | null;
}