// services/DocFetchService.ts

import { Core } from '../modules/Core';
import { ContentParser } from './ContentParser';
import { Elements } from '../enums/Elements';
import { SettingsManager } from '../modules/SettingsManager';
import { fetchWithBackoff } from '../utils/fetchWithBackoff';

/**
 * Document fetch and refresh service for FFN private author documents.
 * Handles fetching doc pages, extracting content, and refreshing via hidden iframe.
 */
export const DocFetchService = {
    MODULE_NAME: 'DocFetchService',

    /**
     * Fetches a Doc Edit page (`/docs/edit.php?docid=X`) and returns the parsed Document.
     * Delegates retry/backoff logic to the shared `fetchWithBackoff` utility.
     */
    _fetchDocPage: async function (docId: string, title: string): Promise<Document | null> {
        const log = Core.getLogger(this.MODULE_NAME, '_fetchDocPage');

        return fetchWithBackoff<Document>({
            url: `https://www.fanfiction.net/docs/edit.php?docid=${docId}`,
            maxRetries: SettingsManager.get('fetchMaxRetries'),
            getDelay: (attempt) => attempt * SettingsManager.get('fetchRetryBaseMs'),
            onSuccess: async (resp) => {
                const text = await resp.text();
                return new DOMParser().parseFromString(text, 'text/html');
            },
            onError: (resp) => {
                if (resp.status === 429) {
                    log(`Rate limit exceeded for "${title}". Please wait a moment.`);
                } else {
                    log(`Network error for "${docId}": HTTP ${resp.status}`);
                }
                return null;
            },
            onRetry: (attempt, waitTime) => {
                log(`Rate limited (429) for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt})`);
            },
        });
    },

    /**
     * Fetches a private author document and returns its content as **Markdown**.
     */
    fetchAndConvertPrivateDoc: async function (docId: string, title: string): Promise<string | null> {
        const log = Core.getLogger(this.MODULE_NAME, 'fetchAndConvertPrivateDoc');

        const doc = await this._fetchDocPage(docId, title);
        if (!doc) return null;

        const markdown = ContentParser.parseContentFromPrivateDoc(doc, title);
        if (markdown) {
            log(`Markdown extracted for "${title}". Length: ${markdown.length}`);
            return markdown;
        }
        return null;
    },

    /**
     * Fetches a private author document and returns its content as **raw HTML**.
     * The HTML is the exact value from FFN's editor textarea — no conversion applied.
     */
    fetchPrivateDocAsHtml: async function (docId: string, title: string): Promise<string | null> {
        const log = Core.getLogger(this.MODULE_NAME, 'fetchPrivateDocAsHtml');

        const doc = await this._fetchDocPage(docId, title);
        if (!doc) return null;

        const html = ContentParser.parseHtmlFromPrivateDoc(doc, title);
        if (html) {
            log(`HTML extracted for "${title}". Length: ${html.length}`);
            return html;
        }
        return null;
    },

    /**
     * Refreshes a document by loading it in a hidden iframe and clicking Save.
     * This lets FFN handle preserving the content - we just trigger the save action.
     * Running in a hidden iframe means no popup window is needed, matching the
     * background behaviour of the export functions.
     *
     * **SAFETY GUARDRAIL**: First checks if the document has content before proceeding.
     * If the document is empty, we abort to prevent accidental data loss.
     *
     * @param docId - The internal FFN Document ID.
     * @param title - The title of the document (for logging).
     * @param attempt - (Internal) Current retry attempt number.
     * @returns A promise resolving to true on success, false on failure.
     */
    refreshPrivateDoc: async function (docId: string, title: string, attempt: number = 1): Promise<boolean> {
        const log = Core.getLogger(this.MODULE_NAME, 'refreshPrivateDoc');
        const MAX_RETRIES = SettingsManager.get('fetchMaxRetries');

        try {
            log(`[REFRESH START] Attempting to refresh "${title}" (DocID: ${docId}, Attempt: ${attempt}/${MAX_RETRIES})`);

            // ============================================================
            // SAFETY GUARDRAIL: Check if document has content
            // ============================================================
            log(`[REFRESH] Verifying document has content...`);

            const doc = await fetchWithBackoff<Document>({
                url: `https://www.fanfiction.net/docs/edit.php?docid=${docId}`,
                maxRetries: SettingsManager.get('fetchMaxRetries'),
                getDelay: (attempt) => attempt * SettingsManager.get('fetchRetryBaseMs'),
                onSuccess: async (resp) => {
                    const text = await resp.text();
                    return new DOMParser().parseFromString(text, 'text/html');
                },
                onError: (resp) => {
                    log(`[REFRESH ERROR] Failed to fetch document for verification: ${resp.status}`);
                    return null;
                },
                onRetry: (attempt, waitTime) => {
                    log(`[REFRESH] Verification fetch failed. Retrying in ${waitTime}ms... (Attempt ${attempt})`);
                },
            });

            if (!doc) {
                return false;
            }

            const contentElement = Core.getElement(Elements.EDITOR_TEXT_AREA, doc);

            if (!contentElement) {
                log(`[REFRESH ERROR] Could not find content textarea for "${title}"`);
                return false;
            }

            const rawValue = (contentElement as HTMLTextAreaElement).value || contentElement.innerHTML;
            const trimmedContent = rawValue.trim();

            // If content is empty or just whitespace, abort to prevent data loss
            if (!trimmedContent || trimmedContent.length === 0) {
                log(`[REFRESH BLOCKED] Document "${title}" appears to be empty. Aborting refresh to prevent data loss.`);
                console.warn(`⚠️ REFRESH BLOCKED: Document "${title}" (DocID: ${docId}) has no content. Skipping to prevent accidental deletion.`);
                return false;
            }

            log(`[REFRESH] Content verified (${trimmedContent.length} chars). Proceeding with refresh...`);

            // ============================================================
            // Proceed with refresh via hidden iframe (no popup required)
            // ============================================================
            log(`[REFRESH] Loading document in hidden iframe...`);

            const saveSuccess = await new Promise<boolean>((resolve) => {
                // Create a hidden, off-screen iframe so the save runs in the background.
                // This avoids needing popup permissions while still performing a real
                // browser form submission (sec-fetch-dest: "document").
                const iframe = document.createElement('iframe');
                iframe.name = `_ffn_refresh_${docId}`;
                iframe.style.position = 'absolute';
                iframe.style.width = '1px';
                iframe.style.height = '1px';
                iframe.style.left = '-9999px';
                iframe.style.top = '-9999px';
                iframe.style.border = 'none';
                iframe.style.visibility = 'hidden';
                document.body.appendChild(iframe);
                iframe.src = `https://www.fanfiction.net/docs/edit.php?docid=${docId}`;

                log(`[REFRESH] Hidden iframe created, waiting for page load...`);

                // Helper: Cleans up the iframe from the DOM
                const removeIframe = () => {
                    clearPageHide();
                    if (iframe.parentNode) {
                        iframe.parentNode.removeChild(iframe);
                    }
                };

                // Cleanup on page navigation to prevent detached DOM accumulation
                const onPageHide = () => removeIframe();
                window.addEventListener('pagehide', onPageHide);
                const clearPageHide = () => window.removeEventListener('pagehide', onPageHide);

                // Helper function to wait for the save button to appear in the iframe's DOM
                const waitForSaveButton = (maxAttempts: number = 50): Promise<HTMLElement | null> => {
                    return new Promise((resolveBtn) => {
                        let attempts = 0;
                        const checkForButton = setInterval(() => {
                            attempts++;
                            try {
                                const iframeDoc = iframe.contentDocument;
                                if (!iframeDoc) {
                                    clearInterval(checkForButton);
                                    resolveBtn(null);
                                    return;
                                }

                                // Check if document has actual content (not just empty structure)
                                const hasContent = iframeDoc.body && iframeDoc.body.children.length > 0;

                                if (hasContent) {
                                    const submitButton = Core.getElement(Elements.SAVE_BUTTON, iframeDoc);
                                    if (submitButton) {
                                        clearInterval(checkForButton);
                                        log(`[REFRESH] Save button found after ${attempts * 200}ms`);
                                        resolveBtn(submitButton);
                                        return;
                                    }
                                }

                                if (attempts >= maxAttempts) {
                                    clearInterval(checkForButton);
                                    log(`[REFRESH ERROR] Save button not found after ${maxAttempts * 200}ms`);
                                    resolveBtn(null);
                                }
                            } catch (e) {
                                clearInterval(checkForButton);
                                log(`[REFRESH ERROR] Exception while waiting for button: ${e}`);
                                resolveBtn(null);
                            }
                        }, 200);
                    });
                };

                // Wait for iframe to reach complete state AND have content
                const checkInterval = setInterval(async () => {
                    try {
                        const iframeDoc = iframe.contentDocument;
                        // Check if iframe loaded and has the document
                        if (iframeDoc && iframeDoc.readyState === 'complete') {
                            clearInterval(checkInterval);

                            try {
                                log(`[REFRESH] Page readyState complete, waiting for content to load...`);

                                // Wait for the save button to actually appear in the DOM
                                const submitButton = await waitForSaveButton();

                                if (!submitButton) {
                                    log(`[REFRESH ERROR] Could not find Submit button in hidden iframe`);
                                    removeIframe();
                                    resolve(false);
                                    return;
                                }

                                // Listen for page navigation (submit completion)
                                let submitCompleted = false;
                                const checkSubmit = setInterval(() => {
                                    try {
                                        const currentDoc = iframe.contentDocument;
                                        // Check if page has reloaded (URL may change or readyState)
                                        if (currentDoc && currentDoc.readyState === 'complete' && !submitCompleted) {
                                            const successPanel = Core.getElement(Elements.SUCCESS_PANEL, currentDoc);
                                            if (successPanel?.innerHTML.includes('successfully saved') || successPanel?.innerHTML.includes('Success')) {
                                                submitCompleted = true;
                                                clearInterval(checkSubmit);
                                                log(`[REFRESH SUCCESS] Document saved successfully`);
                                                console.log(`✓ REFRESH SUCCESS: Document ${docId} (${title}) saved successfully`);
                                                setTimeout(removeIframe, 500);
                                                resolve(true);
                                            }
                                        }
                                    } catch (e) {
                                        // iframe might be detached or navigated cross-origin
                                        clearInterval(checkSubmit);
                                    }
                                }, 200);

                                // Click the Save button (this triggers sec-fetch-dest: "document")
                                // FFN will preserve the existing content when we submit without changes
                                log(`[REFRESH] Clicking Save button...`);
                                submitButton.click();

                                // Timeout if no success after configured iframeSaveTimeoutMs
                                const saveTimeout = SettingsManager.get('iframeSaveTimeoutMs');
                                setTimeout(() => {
                                    if (!submitCompleted) {
                                        clearInterval(checkSubmit);
                                        log(`[REFRESH TIMEOUT] No confirmation received after ${saveTimeout}ms`);
                                        removeIframe();
                                        resolve(false);
                                    }
                                }, saveTimeout);

                            } catch (e) {
                                log(`[REFRESH ERROR] Error manipulating iframe: ${e}`);
                                removeIframe();
                                resolve(false);
                            }
                        }
                    } catch (e) {
                        // Can't access iframe content (cross-origin or detached)
                        clearInterval(checkInterval);
                        log(`[REFRESH ERROR] Lost access to iframe: ${e}`);
                        resolve(false);
                    }
                }, 100);

                // Timeout if iframe doesn't load after configured iframeLoadTimeoutMs
                const loadTimeout = SettingsManager.get('iframeLoadTimeoutMs');
                setTimeout(() => {
                    clearInterval(checkInterval);
                    log(`[REFRESH TIMEOUT] Iframe didn't load after ${loadTimeout}ms`);
                    removeIframe();
                    resolve(false);
                }, loadTimeout);
            });

            // Retry with exponential backoff if failed
            if (!saveSuccess && attempt < MAX_RETRIES) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[REFRESH] Refresh failed for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${MAX_RETRIES})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.refreshPrivateDoc(docId, title, attempt + 1);
            }

            return saveSuccess;

        } catch (err) {
            log(`[REFRESH ERROR] Exception during refresh:`, err);
            console.error(`REFRESH FAILED for document ${docId}:`, err);

            // Retry with exponential backoff if failed
            if (attempt < MAX_RETRIES) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[REFRESH] Exception occurred. Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${MAX_RETRIES})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.refreshPrivateDoc(docId, title, attempt + 1);
            }

            return false;
        }
    },
};
