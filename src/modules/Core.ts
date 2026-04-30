// modules/Core.ts

import { Elements } from '../enums/Elements';
import { StoryDelegate } from '../delegates/StoryDelegate';
import { IDelegate } from '../delegates/IDelegate';
import { DocManagerDelegate } from '../delegates/DocManagerDelegate';
import { DocEditorDelegate } from '../delegates/DocEditorDelegate';
import { GlobalDelegate } from '../delegates/GlobalDelegate';
import { FFNLogger } from './FFNLogger';

/**
 * Shared utility engine providing logging, DOM readiness,
 * and the central Broker for the Delegate (Page Object) system.
 */
export const Core = {
    MODULE_NAME: 'Core',

    /**
     * The currently active Delegate strategy (Story vs Doc vs Global).
     */
    activeDelegate: null as IDelegate | null,

    /**
     * Centralized logging function with standardized formatting.
     * @param pageName - The context/module name (e.g., 'doc-manager').
     * @param funcName - The specific function generating the log.
     * @param msg - The message to log.
     * @param data - Optional data object to log alongside the message.
     */
    log: function (pageName: string, funcName: string, msg: string, data?: any) {
        FFNLogger.log(pageName, funcName, msg, data);
    },

    /**
     * Logger Factory: Returns a bound logging function for a specific context.
     * This prevents manual repetition of page and function names in every log call.
     * @param pageName - The context/module name.
     * @param funcName - The specific function name.
     * @returns A function that accepts (msg, data).
     */
    getLogger: function (pageName: string, funcName: string) {
        return FFNLogger.getLogger(pageName, funcName);
    },

    /**
     * Runs a callback when the DOM is fully loaded.
     * Essential for userscripts running at 'document-start'.
     * @param callback - The function to execute once the DOM is ready.
     */
    onDomReady: function (callback: () => void) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else {
            callback();
        }
    },

    /**
     * Main Bootstrapper.
     * Detects the current page, sets the delegate, and initializes layout managers.
     * Call this from your main entry point (e.g., index.ts).
     */
    startup: function (path: string) {
        const log = this.getLogger(this.MODULE_NAME, 'startup');
        this.setDelegate(path);
        log('Core System initialized and ready.');
    },

    // ==========================================
    // DELEGATE SYSTEM
    // ==========================================

    /**
     * Determines which Delegate strategy to use based on the current URL path.
     * This abstracts away the DOM differences between pages.
     * @param pagePath - window.location.pathname
     */
    setDelegate: function (pagePath: string) {
        const log = this.getLogger(this.MODULE_NAME, 'setDelegate');

        if (pagePath.startsWith('/s/')) {
            this.activeDelegate = StoryDelegate;
            log('Strategy set to StoryDelegate');
        }
        else if (pagePath === "/docs/docs.php") {
            this.activeDelegate = DocManagerDelegate;
            log('Strategy set to DocManagerDelegate');
        }
        else if (pagePath.includes("/docs/edit.php")) {
            this.activeDelegate = DocEditorDelegate;
            log('Strategy set to DocEditorDelegate');
        }
        else {
            log('No specific delegate found for this path.');
        }
    },

    /**
     * Public API: Fetches a SINGLE element.
     * Guaranteed to return an HTMLElement or null. No Arrays.
     * Implements Chain of Responsibility: Specific Delegate -> Global Delegate.
     * @param key - The Element Enum key.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns The found HTMLElement or null.
     */
    getElement: function (key: Elements, doc?: Document): HTMLElement | null {
        const log = this.getLogger(this.MODULE_NAME, 'getElement');
        let el: HTMLElement | null = null;

        // 1. Try Page-Specific
        if (this.activeDelegate) {
            el = this.activeDelegate.getElement(key, doc);
        }

        // 2. Try Global
        if (!el) {
            el = GlobalDelegate.getElement(key, doc);
        }

        // 3. Logging / Error Handling
        if (!el) {
            log(`Selector failed for key: ${key}`);
        }

        return el;
    },

    /**
     * Public API: Fetches a LIST of elements.
     * Guaranteed to return an Array. No nulls.
     * Implements Chain of Responsibility: Specific Delegate -> Global Delegate.
     * @param key - The Element Enum key.
     * @param doc - A document override if the delegate is supposed to be fetching from another window.
     * @returns An array of HTMLElements (empty if none found).
     */
    getElements: function (key: Elements, doc?: Document): HTMLElement[] {
        let els: HTMLElement[] = [];

        // 1. Try Page-Specific
        if (this.activeDelegate) {
            els = this.activeDelegate.getElements(key, doc);
        }

        // 2. Try Global (only if page specific returned nothing)
        if (els.length === 0) {
            els = GlobalDelegate.getElements(key, doc);
        }

        return els;
    },

};

