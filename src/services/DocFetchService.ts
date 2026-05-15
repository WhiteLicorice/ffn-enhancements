// services/DocFetchService.ts

import { Core } from '../modules/Core';
import { ContentParser } from './ContentParser';
import { Elements } from '../enums/Elements';
import { SettingsManager } from '../modules/SettingsManager';
import { fetchWithBackoff } from '../utils/fetchWithBackoff';

interface SavePrivateDocOptions {
    operationLabel: 'REFRESH' | 'IMPORT';
    replacementHtml?: string;
}

interface TinyMceEditorLike {
    setContent?: (html: string) => void;
    save?: () => void;
}

interface TinyMceLike {
    get?: (id: string) => TinyMceEditorLike | null;
    activeEditor?: TinyMceEditorLike | null;
}

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
     * This lets FFN preserve the existing content while extending document life.
     */
    refreshPrivateDoc: async function (docId: string, title: string, attempt: number = 1): Promise<boolean> {
        const log = Core.getLogger(this.MODULE_NAME, 'refreshPrivateDoc');
        const maxRetries = SettingsManager.get('fetchMaxRetries');

        try {
            log(`[REFRESH START] Attempting to refresh "${title}" (DocID: ${docId}, Attempt: ${attempt}/${maxRetries})`);
            log('[REFRESH] Verifying document has content...');

            const doc = await fetchWithBackoff<Document>({
                url: `https://www.fanfiction.net/docs/edit.php?docid=${docId}`,
                maxRetries,
                getDelay: (retryAttempt) => retryAttempt * SettingsManager.get('fetchRetryBaseMs'),
                onSuccess: async (resp) => {
                    const text = await resp.text();
                    return new DOMParser().parseFromString(text, 'text/html');
                },
                onError: (resp) => {
                    log(`[REFRESH ERROR] Failed to fetch document for verification: ${resp.status}`);
                    return null;
                },
                onRetry: (retryAttempt, waitTime) => {
                    log(`[REFRESH] Verification fetch failed. Retrying in ${waitTime}ms... (Attempt ${retryAttempt})`);
                },
            });

            if (!doc) return false;

            const contentElement = Core.getElement(Elements.EDITOR_TEXT_AREA, doc);
            if (!contentElement) {
                log(`[REFRESH ERROR] Could not find content textarea for "${title}"`);
                return false;
            }

            const rawValue = (contentElement as HTMLTextAreaElement).value || contentElement.innerHTML;
            const trimmedContent = rawValue.trim();

            if (!trimmedContent) {
                log(`[REFRESH BLOCKED] Document "${title}" appears to be empty. Aborting refresh to prevent data loss.`);
                console.warn(`REFRESH BLOCKED: Document "${title}" (DocID: ${docId}) has no content. Skipping to prevent accidental deletion.`);
                return false;
            }

            log(`[REFRESH] Content verified (${trimmedContent.length} chars). Proceeding with refresh...`);
            const saveSuccess = await this._savePrivateDocViaIframe(docId, title, {
                operationLabel: 'REFRESH',
            });

            if (!saveSuccess && attempt < maxRetries) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[REFRESH] Refresh failed for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.refreshPrivateDoc(docId, title, attempt + 1);
            }

            return saveSuccess;
        } catch (err) {
            log('[REFRESH ERROR] Exception during refresh:', err);
            console.error(`REFRESH FAILED for document ${docId}:`, err);

            if (attempt < maxRetries) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[REFRESH] Exception occurred. Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.refreshPrivateDoc(docId, title, attempt + 1);
            }

            return false;
        }
    },

    /**
     * Replaces a private document's editor content with provided HTML, then saves.
     * Used by DocManager bulk import after Markdown has been converted to HTML.
     */
    replacePrivateDocContent: async function (
        docId: string,
        title: string,
        replacementHtml: string,
        attempt: number = 1,
    ): Promise<boolean> {
        const log = Core.getLogger(this.MODULE_NAME, 'replacePrivateDocContent');
        const maxRetries = SettingsManager.get('fetchMaxRetries');

        if (!replacementHtml.trim()) {
            log(`[IMPORT BLOCKED] Replacement content for "${title}" is empty.`);
            return false;
        }

        try {
            log(`[IMPORT START] Replacing "${title}" (DocID: ${docId}, Attempt: ${attempt}/${maxRetries})`);
            const saveSuccess = await this._savePrivateDocViaIframe(docId, title, {
                operationLabel: 'IMPORT',
                replacementHtml,
            });

            if (!saveSuccess && attempt < maxRetries) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[IMPORT] Save failed for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.replacePrivateDocContent(docId, title, replacementHtml, attempt + 1);
            }

            return saveSuccess;
        } catch (err) {
            log('[IMPORT ERROR] Exception during import save:', err);
            console.error(`IMPORT FAILED for document ${docId}:`, err);

            if (attempt < maxRetries) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[IMPORT] Exception occurred. Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.replacePrivateDocContent(docId, title, replacementHtml, attempt + 1);
            }

            return false;
        }
    },

    /**
     * Shared hidden-iframe save implementation for refresh and import.
     */
    _savePrivateDocViaIframe: async function (
        docId: string,
        title: string,
        options: SavePrivateDocOptions,
    ): Promise<boolean> {
        const log = Core.getLogger(this.MODULE_NAME, '_savePrivateDocViaIframe');
        const label = options.operationLabel;

        log(`[${label}] Loading document in hidden iframe...`);

        return new Promise<boolean>((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.name = `_ffn_${label.toLowerCase()}_${docId}`;
            iframe.style.position = 'absolute';
            iframe.style.width = '1px';
            iframe.style.height = '1px';
            iframe.style.left = '-9999px';
            iframe.style.top = '-9999px';
            iframe.style.border = 'none';
            iframe.style.visibility = 'hidden';
            document.body.appendChild(iframe);

            let isResolved = false;
            let checkInterval: number | null = null;
            let loadTimer: number | null = null;
            let saveTimer: number | null = null;
            let submitInterval: number | null = null;

            const clearTimer = (timerId: number | null, clearFn: (id: number) => void) => {
                if (timerId !== null) clearFn(timerId);
            };

            const removeIframe = () => {
                clearTimer(checkInterval, window.clearInterval);
                clearTimer(loadTimer, window.clearTimeout);
                clearTimer(saveTimer, window.clearTimeout);
                clearTimer(submitInterval, window.clearInterval);
                window.removeEventListener('pagehide', onPageHide);
                if (iframe.parentNode) {
                    iframe.parentNode.removeChild(iframe);
                }
            };

            const resolveOnce = (value: boolean) => {
                if (isResolved) return;
                isResolved = true;
                removeIframe();
                resolve(value);
            };

            const onPageHide = () => resolveOnce(false);
            window.addEventListener('pagehide', onPageHide);

            const waitForSaveButton = (maxAttempts: number = 50): Promise<HTMLElement | null> => {
                return new Promise((resolveBtn) => {
                    let attempts = 0;
                    const buttonInterval = window.setInterval(() => {
                        attempts++;
                        try {
                            const iframeDoc = iframe.contentDocument;
                            if (!iframeDoc) {
                                window.clearInterval(buttonInterval);
                                resolveBtn(null);
                                return;
                            }

                            const hasContent = iframeDoc.body && iframeDoc.body.children.length > 0;
                            if (hasContent) {
                                const submitButton = Core.getElement(Elements.SAVE_BUTTON, iframeDoc);
                                if (submitButton) {
                                    window.clearInterval(buttonInterval);
                                    log(`[${label}] Save button found after ${attempts * 200}ms`);
                                    resolveBtn(submitButton);
                                    return;
                                }
                            }

                            if (attempts >= maxAttempts) {
                                window.clearInterval(buttonInterval);
                                log(`[${label} ERROR] Save button not found after ${maxAttempts * 200}ms`);
                                resolveBtn(null);
                            }
                        } catch (e) {
                            window.clearInterval(buttonInterval);
                            log(`[${label} ERROR] Exception while waiting for button: ${e}`);
                            resolveBtn(null);
                        }
                    }, 200);
                });
            };

            checkInterval = window.setInterval(async () => {
                try {
                    const iframeDoc = iframe.contentDocument;
                    if (!iframeDoc || iframeDoc.readyState !== 'complete') return;

                    clearTimer(checkInterval, window.clearInterval);
                    checkInterval = null;
                    log(`[${label}] Page readyState complete, waiting for editor controls...`);

                    const submitButton = await waitForSaveButton();
                    if (!submitButton) {
                        log(`[${label} ERROR] Could not find Submit button in hidden iframe`);
                        resolveOnce(false);
                        return;
                    }

                    if (options.replacementHtml !== undefined) {
                        const didReplace = this._applyReplacementContent(iframe, options.replacementHtml);
                        if (!didReplace) {
                            log(`[${label} ERROR] Could not replace editor content for "${title}"`);
                            resolveOnce(false);
                            return;
                        }
                    }

                    let submitCompleted = false;
                    submitInterval = window.setInterval(() => {
                        try {
                            const currentDoc = iframe.contentDocument;
                            if (currentDoc && currentDoc.readyState === 'complete' && !submitCompleted) {
                                const successPanel = Core.getElement(Elements.SUCCESS_PANEL, currentDoc);
                                if (successPanel?.innerHTML.includes('successfully saved') || successPanel?.innerHTML.includes('Success')) {
                                    submitCompleted = true;
                                    log(`[${label} SUCCESS] Document saved successfully`);
                                    console.log(`${label} SUCCESS: Document ${docId} (${title}) saved successfully`);
                                    resolveOnce(true);
                                }
                            }
                        } catch {
                            clearTimer(submitInterval, window.clearInterval);
                            submitInterval = null;
                        }
                    }, 200);

                    log(`[${label}] Clicking Save button...`);
                    submitButton.click();

                    const saveTimeout = SettingsManager.get('iframeSaveTimeoutMs');
                    saveTimer = window.setTimeout(() => {
                        if (!submitCompleted) {
                            log(`[${label} TIMEOUT] No confirmation received after ${saveTimeout}ms`);
                            resolveOnce(false);
                        }
                    }, saveTimeout);
                } catch (e) {
                    clearTimer(checkInterval, window.clearInterval);
                    checkInterval = null;
                    log(`[${label} ERROR] Lost access to iframe: ${e}`);
                    resolveOnce(false);
                }
            }, 100);

            const loadTimeout = SettingsManager.get('iframeLoadTimeoutMs');
            loadTimer = window.setTimeout(() => {
                log(`[${label} TIMEOUT] Iframe did not load after ${loadTimeout}ms`);
                resolveOnce(false);
            }, loadTimeout);

            iframe.src = `https://www.fanfiction.net/docs/edit.php?docid=${docId}`;
        });
    },

    /**
     * Pushes replacement HTML into TinyMCE, its editor iframe, and the backing textarea.
     */
    _applyReplacementContent: function (iframe: HTMLIFrameElement, replacementHtml: string): boolean {
        const log = Core.getLogger(this.MODULE_NAME, '_applyReplacementContent');
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) return false;

        const textarea = Core.getElement(Elements.EDITOR_TEXT_AREA, iframeDoc) as HTMLTextAreaElement | null;
        if (!textarea) {
            log('Backing textarea not found.');
            return false;
        }

        const editorFrame = Core.getElement(Elements.EDITOR_TEXT_AREA_IFRAME, iframeDoc) as HTMLIFrameElement | null;
        if (editorFrame?.contentDocument?.body) {
            editorFrame.contentDocument.body.innerHTML = replacementHtml;
        }

        const iframeWindow = iframe.contentWindow as (Window & {
            tinymce?: TinyMceLike;
            tinyMCE?: TinyMceLike;
        }) | null;
        const tinyMce = iframeWindow?.tinymce || iframeWindow?.tinyMCE;
        const editor = tinyMce?.get?.('bio') || tinyMce?.activeEditor || null;

        if (editor?.setContent) {
            editor.setContent(replacementHtml);
        }

        textarea.value = replacementHtml;
        textarea.textContent = replacementHtml;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        if (editor?.save) {
            editor.save();
        }

        const savedValue = textarea.value || textarea.textContent || '';
        return savedValue.trim() === replacementHtml.trim();
    },
};
