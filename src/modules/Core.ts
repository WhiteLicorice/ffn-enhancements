// modules/Core.ts

import TurndownService from 'turndown';
import { Elements } from '../enums/Elements';
import { StoryDelegate } from '../delegates/StoryDelegate';
import { IDelegate } from '../delegates/IDelegate';
import { DocManagerDelegate } from '../delegates/DocManagerDelegate';
import { DocEditorDelegate } from '../delegates/DocEditorDelegate';
import { GlobalDelegate } from '../delegates/GlobalDelegate';
import { FFNLogger } from './FFNLogger';

/**
 * Shared utility engine providing logging, DOM readiness, content parsing,
 * and the central Broker for the Delegate (Page Object) system.
 */
export const Core = {
    MODULE_NAME: 'Core',

    /**
     * Instance of TurndownService configured for converting HTML to Markdown.
     * Configured with horizontal rule and bullet list markers.
     */
    turndownService: new TurndownService({
        'hr': '---',
        'bulletListMarker': '-',
    }),  // modern-ish presets used by Markor and the like

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

    // ==========================================
    // CONTENT PARSING
    // ==========================================

    /**
     * Extracts text from a private author-accessible document and converts it to Markdown.
     * Used for both live page parsing and background fetch parsing.
     * @param doc - The document object to query.
     * @param title - The title of the content (for logging purposes).
     * @returns The converted Markdown string, or null if selectors fail.
     */
    parseContentFromPrivateDoc: function (doc: Document, title: string) {
        const log = this.getLogger(this.MODULE_NAME, 'parseContentFromPrivateDoc');
        const contentElement = this.getElement(Elements.EDITOR_TEXT_AREA, doc);

        if (!contentElement) {
            log(`Selectors failed for "${title}"`);
            return null;
        }

        const rawValue = (contentElement as HTMLTextAreaElement).value || contentElement.innerHTML;
        return this.turndownService.turndown(rawValue);
    },

    /**
     * Fetches a specific DocID of an author-accessible document and returns the Markdown content.
     * Includes Exponential Backoff to handle FFN's rate limiting (429).
     * @param docId - The internal FFN Document ID.
     * @param title - The title of the document.
     * @param attempt - (Internal) Current retry attempt number.
     * @returns A promise resolving to the Markdown string or null.
     */
    fetchAndConvertPrivateDoc: async function (docId: string, title: string, attempt: number = 1): Promise<string | null> {
        const log = this.getLogger(this.MODULE_NAME, 'fetchAndConvertPrivateDoc');
        const MAX_RETRIES = 3;

        try {
            const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);

            // --- Rate Limit Handling ---
            if (response.status === 429) {
                if (attempt <= MAX_RETRIES) {
                    const waitTime = attempt * 2000; // 2s, 4s, 6s...
                    log(`Rate limited (429) for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt})`);
                    await new Promise(r => setTimeout(r, waitTime));
                    return this.fetchAndConvertPrivateDoc(docId, title, attempt + 1);
                }
                log(`Rate limit exceeded for "${title}". Please wait a moment.`);
                return null;
            }

            if (!response.ok) {
                log(`Network Error for ${docId}: ${response.status}`);
                return null;
            }

            const text = await response.text();
            const doc = new DOMParser().parseFromString(text, 'text/html');
            const markdown = this.parseContentFromPrivateDoc(doc, title);

            if (markdown) {
                log(`Content extracted for "${title}". Length: ${markdown.length}`);
                return markdown;
            }
        } catch (err) {
            log(`Error processing ${title}`, err);
        }
        return null;
    },

    /**
     * Refreshes a document by opening it in a new window and clicking Save.
     * This lets FFN handle preserving the content - we just trigger the save action.
     * @param docId - The internal FFN Document ID.
     * @param title - The title of the document (for logging).
     * @param attempt - (Internal) Current retry attempt number.
     * @returns A promise resolving to true on success, false on failure.
     */
    refreshPrivateDoc: async function (docId: string, title: string, attempt: number = 1): Promise<boolean> {
        const log = this.getLogger(this.MODULE_NAME, 'refreshPrivateDoc');
        const _MAX_RETRIES = 3; // FIXME: Implement exponential backoff as well, using MAX_RETRIES and attempt args.

        try {
            log(`[REFRESH START] Attempting to refresh "${title}" (DocID: ${docId})`);
            log(`[REFRESH] Opening document in new window...`);
            
            const saveSuccess = await new Promise<boolean>((resolve) => {
                // Open the edit page in a new window
                const win = window.open(
                    `https://www.fanfiction.net/docs/edit.php?docid=${docId}`,
                    `_ffn_refresh_${docId}`,
                    'width=1,height=1,left=10000'  // Tiny window off-screen
                );
                
                if (!win) {
                    log(`[REFRESH ERROR] Failed to open window (pop-up blocker?)`);
                    console.error(`REFRESH FAILED: Could not open window for document ${docId}. Check pop-up blocker.`);
                    resolve(false);
                    return;
                }
                
                log(`[REFRESH] Window opened, waiting for page load...`);
                
                // Wait for the window to load
                const checkInterval = setInterval(() => {
                    try {
                        // Check if window loaded and has the document
                        if (win.document && win.document.readyState === 'complete') {
                            clearInterval(checkInterval);
                            
                            try {
                                log(`[REFRESH] Page loaded, finding Save button...`);
                                const winDoc = win.document;
                                const submitButton = this.getElement(Elements.SAVE_BUTTON, winDoc);
                                 // FIXME: At this point, the HTML body has not fully loaded yet
                                 // and appears as an empty document:
                                 /**
                                  * <html>
                                  * <head><head>
                                  * <body><body>
                                  * </html>
                                  */
                                 // The fix is to properly await the loading of the page in the window that opens
                                 // so our selector successfully fetches the save button.
                                console.log(winDoc);
                                if (!submitButton) {
                                    log(`[REFRESH ERROR] Could not find Submit button in opened window`);
                                    //win.close();
                                    resolve(false);
                                    return;
                                }
                                
                                // Listen for page navigation (submit completion)
                                let submitCompleted = false;
                                const checkSubmit = setInterval(() => {
                                    try {
                                        // Check if page has reloaded (URL may change or readyState)
                                        if (win.document.readyState === 'complete' && !submitCompleted) {
                                            const body = win.document.body.innerHTML;
                                            if (body.includes('successfully saved') || body.includes('Success')) {
                                                submitCompleted = true;
                                                clearInterval(checkSubmit);
                                                log(`[REFRESH SUCCESS] Document saved successfully`);
                                                console.log(`✓ REFRESH SUCCESS: Document ${docId} (${title}) saved successfully`);
                                                setTimeout(() => win.close(), 500);
                                                resolve(true);
                                            }
                                        }
                                    } catch (e) {
                                        // Window might be closed or cross-origin
                                        clearInterval(checkSubmit);
                                    }
                                }, 200);
                                
                                // Click the Save button (this triggers sec-fetch-dest: "document")
                                // FFN will preserve the existing content when we submit without changes
                                log(`[REFRESH] Clicking Save button...`);
                                submitButton.click();
                                
                                // Timeout if no success after 10 seconds
                                setTimeout(() => {
                                    if (!submitCompleted) {
                                        clearInterval(checkSubmit);
                                        log(`[REFRESH TIMEOUT] No confirmation received after 10s`);
                                        try { win.close(); } catch (e) { /* ignore */ }
                                        resolve(false);
                                    }
                                }, 10000);
                                
                            } catch (e) {
                                log(`[REFRESH ERROR] Error manipulating window: ${e}`);
                                try { win.close(); } catch (e2) { /* ignore */ }
                                resolve(false);
                            }
                        }
                    } catch (e) {
                        // Can't access window (cross-origin or closed)
                        clearInterval(checkInterval);
                        log(`[REFRESH ERROR] Lost access to window: ${e}`);
                        resolve(false);
                    }
                }, 100);
                
                // Timeout if window doesn't load after 30 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    try {
                        if (win && !win.closed) {
                            log(`[REFRESH TIMEOUT] Window didn't load after 30s`);
                            win.close();
                        }
                    } catch (e) { /* ignore */ }
                    resolve(false);
                }, 30000);
            });
            
            return saveSuccess;
            
        } catch (err) {
            log(`[REFRESH ERROR] Exception during refresh:`, err);
            console.error(`REFRESH FAILED for document ${docId}:`, err);
            return false;
        }
    },

    /**
     * Exports all author documents from Doc Manager in bulk.
     * Shows progress in the button text and handles failures gracefully.
     */
    bulkExportPrivateDocs: async function () {
        const log = this.getLogger(this.MODULE_NAME, 'bulkExportPrivateDocs');
        
        // Find all export links
        const exportLinks = Array.from(document.querySelectorAll('a[href*="docs/export.php"]'));
        
        if (exportLinks.length === 0) {
            log('No documents to export');
            return;
        }
        
        log(`Found ${exportLinks.length} documents to export`);
        const button = document.querySelector('[data-action="bulk-export"]') as HTMLElement;
        
        // First pass - attempt all exports
        const results = [];
        for (let i = 0; i < exportLinks.length; i++) {
            const link = exportLinks[i] as HTMLAnchorElement;
            const row = link.closest('tr');
            if (!row) continue;
            
            const titleCell = row.cells[0];
            const title = titleCell?.textContent?.trim() || 'Unknown';
            const docId = link.href.match(/docid=(\d+)/)?.[1];
            
            if (!docId) continue;
            
            if (button) button.textContent = `↓ ${i + 1}/${exportLinks.length}`;
            
            const markdown = await this.fetchAndConvertPrivateDoc(docId, title);
            results.push({ docId, title, markdown, element: link });
            
            // Add small delay between requests
            await new Promise(r => setTimeout(r, 1000));
        }
        
        // Second pass - retry failures
        if (button) button.textContent = 'Cooling...';
        await new Promise(r => setTimeout(r, 5000));
        
        const failures = results.filter(r => !r.markdown);
        if (failures.length > 0) {
            log(`Retrying ${failures.length} failed exports`);
            for (let i = 0; i < failures.length; i++) {
                const { docId, title } = failures[i];
                if (button) button.textContent = `Retry ${i + 1}/${failures.length}`;
                
                const markdown = await this.fetchAndConvertPrivateDoc(docId, title);
                if (markdown) {
                    failures[i].markdown = markdown;
                }
                await new Promise(r => setTimeout(r, 3000));
            }
        }
        
        // Show results
        const successCount = results.filter(r => r.markdown).length;
        log(`Export complete: ${successCount}/${results.length} successful`);
        
        // Update UI
        results.forEach(({ markdown, element }) => {
            const cell = element.closest('td');
            if (cell) {
                if (markdown) {
                    cell.innerHTML += ' <span style="color:green">✓</span>';
                } else {
                    cell.innerHTML += ' <span style="color:red">✗</span>';
                }
            }
        });
        
        if (button) button.textContent = `All Done!`;
        setTimeout(() => {
            if (button) button.textContent = '↓ All';
        }, 3000);
    },

    /**
     * Refreshes all author documents from Doc Manager in bulk.
     * Shows progress in the button text and handles failures gracefully.
     */
    bulkRefreshPrivateDocs: async function () {
        const log = this.getLogger(this.MODULE_NAME, 'bulkRefreshPrivateDocs');
        
        // Find all refresh links
        const refreshLinks = Array.from(document.querySelectorAll('a[data-action="refresh-doc"]'));
        
        if (refreshLinks.length === 0) {
            log('No documents to refresh');
            return;
        }
        
        log(`Found ${refreshLinks.length} documents to refresh`);
        const button = document.querySelector('[data-action="bulk-refresh"]') as HTMLElement;
        
        // First pass - attempt all refreshes
        const results = [];
        for (let i = 0; i < refreshLinks.length; i++) {
            const link = refreshLinks[i] as HTMLAnchorElement;
            const row = link.closest('tr');
            if (!row) continue;
            
            const titleCell = row.cells[0];
            const title = titleCell?.textContent?.trim() || 'Unknown';
            const docId = link.getAttribute('data-docid');
            
            if (!docId) continue;
            
            if (button) button.textContent = `↻ ${i + 1}/${refreshLinks.length}`;
            
            const success = await this.refreshPrivateDoc(docId, title);
            results.push({ docId, title, success, element: link });
            
            // Add small delay between requests
            await new Promise(r => setTimeout(r, 1000));
        }
        
        // Second pass - retry failures
        if (button) button.textContent = 'Cooling...';
        await new Promise(r => setTimeout(r, 5000));
        
        const failures = results.filter(r => !r.success);
        if (failures.length > 0) {
            log(`Retrying ${failures.length} failed refreshes`);
            for (let i = 0; i < failures.length; i++) {
                const { docId, title } = failures[i];
                if (button) button.textContent = `Retry ${i + 1}/${failures.length}`;
                
                const success = await this.refreshPrivateDoc(docId, title);
                if (success) {
                    failures[i].success = success;
                }
                await new Promise(r => setTimeout(r, 3000));
            }
        }
        
        // Show results
        const successCount = results.filter(r => r.success).length;
        log(`Refresh complete: ${successCount}/${results.length} successful`);
        
        // Update UI
        results.forEach(({ success, element }) => {
            const cell = element.closest('td');
            if (cell) {
                if (success) {
                    cell.innerHTML += ' <span style="color:green">✓</span>';
                } else {
                    cell.innerHTML += ' <span style="color:red">✗</span>';
                }
            }
        });
        
        if (button) button.textContent = `All Done!`;
        setTimeout(() => {
            if (button) button.textContent = '↻ All';
        }, 3000);
    },
};

export default Core;