// services/DocFetchService.ts

import { Core } from '../modules/Core';
import { ContentParser } from './ContentParser';
import { SettingsManager } from '../modules/SettingsManager';
import { fetchWithBackoff } from '../utils/fetchWithBackoff';
import { fetchRequestText, type FetchTextResponse } from '../utils/fetchRequest';

interface SavePrivateDocOptions {
    operationLabel: 'REFRESH' | 'IMPORT';
    replacementHtml?: string;
}

export interface PrivateDocSaveResult {
    ok: boolean;
    reason?: string;
}

interface PrivateDocSaveAttemptResult extends PrivateDocSaveResult {
    retryable: boolean;
}

interface PrivateDocSaveRequestBuildResult {
    ok: boolean;
    reason?: string;
    actionUrl?: string;
    body?: string;
    submittedHtml?: string;
}

const FFN_DOC_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net']);

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeUrlForComparison(value: string | undefined): string {
    if (!value) return '';
    try {
        const parsed = new URL(value, 'https://www.fanfiction.net');
        parsed.hash = '';
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return value.replace(/[?#].*$/, '').replace(/\/+$/, '');
    }
}

function appendSuccessfulControl(params: URLSearchParams, control: Element): void {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) {
        return;
    }

    const name = control.name?.trim();
    if (!name || control.disabled) return;

    if (control instanceof HTMLInputElement) {
        const type = control.type.toLowerCase();
        const excludedTypes = new Set(['file', 'reset', 'button', 'submit', 'image']);
        if (excludedTypes.has(type)) return;
        if ((type === 'checkbox' || type === 'radio') && !control.checked) return;
        params.append(name, control.value);
        return;
    }

    if (control instanceof HTMLTextAreaElement) {
        params.append(name, control.value);
        return;
    }

    if (control.multiple) {
        Array.from(control.selectedOptions).forEach(option => params.append(name, option.value));
        return;
    }

    params.append(name, control.value);
}

/**
 * Document fetch and save service for FFN private author documents.
 * Handles fetching doc pages, extracting content, and direct save submissions.
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
            onRetry: (attempt, waitTime, status) => {
                log(`Transient ${status} for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt})`);
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
     * Validates that a private source document exists and contains non-empty editor content.
     */
    validatePrivateDocHasContentWithResult: async function (docId: string, title: string): Promise<PrivateDocSaveResult> {
        const doc = await this._fetchDocPage(docId, title);
        if (!doc) {
            return { ok: false, reason: 'Could not load the source document.' };
        }

        const trimmedContent = this._getEditorContentForGuard(doc);
        if (trimmedContent === null) {
            return { ok: false, reason: 'Could not find the source document editor content.' };
        }

        if (!trimmedContent) {
            return { ok: false, reason: 'Source document is empty.' };
        }

        return { ok: true };
    },

    /**
     * Reads the backing editor textarea used by FFN private documents.
     * Returns null when the editor was not present, and trimmed content otherwise.
     */
    _getEditorContentForGuard: function (doc: Document): string | null {
        const contentElement = this._getEditorTextarea(doc);
        if (!contentElement) return null;

        const rawValue = contentElement.value || contentElement.innerHTML || '';
        return rawValue.trim();
    },

    /**
     * Locates FFN's backing editor textarea across both private-doc editor variants.
     */
    _getEditorTextarea: function (doc: Document): HTMLTextAreaElement | null {
        const directMatch = doc.querySelector<HTMLTextAreaElement>(
            "textarea[name='bio'], textarea#bio, textarea[name='webcontent'], textarea#webcontent"
        );
        if (directMatch) return directMatch;

        const textareas = Array.from(doc.querySelectorAll<HTMLTextAreaElement>('textarea'));
        return textareas.length === 1 ? textareas[0] : null;
    },

    _getPrivateDocForm: function (doc: Document, textarea?: HTMLTextAreaElement | null): HTMLFormElement | null {
        const candidate = textarea?.closest('form[name="docform"]');
        if (candidate instanceof HTMLFormElement) return candidate;
        return doc.querySelector<HTMLFormElement>('form[name="docform"]');
    },

    _normalizeEditorHtmlForComparison: function (value: string): string {
        return value
            .replace(/\r\n?/g, '\n')
            .replace(/\u00A0/g, ' ')
            .replace(/>\s+</g, '><')
            .replace(/\s+/g, ' ')
            .trim();
    },

    _getPrivateDocExplicitFailureReason: function (
        doc: Document,
        response?: Pick<FetchTextResponse, 'status' | 'isCfChallenge' | 'finalUrl'>
    ): string | null {
        if (response?.isCfChallenge) {
            return 'FFN save request was blocked by a Cloudflare challenge. Open fanfiction.net in this browser, clear the challenge, then retry.';
        }

        const errorPanel = doc.querySelector<HTMLElement>('.panel_error, .gui_error, .alert-error, .error');
        const errorText = normalizeText(errorPanel?.textContent || '');
        if (errorText) return errorText;

        const finalUrlPath = normalizeUrlForComparison(response?.finalUrl);
        if (finalUrlPath && !finalUrlPath.endsWith('/docs/edit.php')) {
            if (/\/login\.php$/i.test(finalUrlPath)) {
                return 'FFN returned a login or authorization page.';
            }
        }

        const bodyText = normalizeText(doc.body?.textContent || '');
        if (/please\s+log\s*in|login\s+required|not\s+authorized|authorization\s+required|sign\s+in/i.test(bodyText)) {
            return 'FFN returned a login or authorization page.';
        }

        if (response?.status === 403) {
            return 'FFN denied access to the document request.';
        }

        return null;
    },

    _getPrivateDocTransportFailure: function (
        response: FetchTextResponse,
        actionDescription: string
    ): PrivateDocSaveAttemptResult | null {
        if (response.isCfChallenge) {
            return {
                ok: false,
                reason: 'FFN save request was blocked by a Cloudflare challenge. Open fanfiction.net in this browser, clear the challenge, then retry.',
                retryable: false,
            };
        }

        if (response.ok) return null;

        if (response.status === 0) {
            return {
                ok: false,
                reason: response.reason || `FFN ${actionDescription} failed before a response was received.`,
                retryable: true,
            };
        }

        if (response.status === 403) {
            return {
                ok: false,
                reason: 'FFN denied access to the document request.',
                retryable: false,
            };
        }

        if (response.status >= 500) {
            return {
                ok: false,
                reason: response.reason || `FFN ${actionDescription} failed with HTTP ${response.status}.`,
                retryable: true,
            };
        }

        return {
            ok: false,
            reason: response.reason || `FFN ${actionDescription} failed with HTTP ${response.status}.`,
            retryable: false,
        };
    },

    _buildPrivateDocSaveRequest: function (
        doc: Document,
        requestUrl: string,
        docId: string,
        options: SavePrivateDocOptions
    ): PrivateDocSaveRequestBuildResult {
        const textarea = this._getEditorTextarea(doc);
        if (!textarea) {
            return { ok: false, reason: 'Could not find the private document editor textarea.' };
        }
        const textareaName = textarea.name?.trim();
        if (!textareaName) {
            return { ok: false, reason: 'Private document editor textarea is missing a name.' };
        }

        const form = this._getPrivateDocForm(doc, textarea);
        if (!form) {
            return { ok: false, reason: 'Could not find the private document save form.' };
        }

        const actionControl = form.querySelector<HTMLInputElement>('input[type="hidden"][name="action"]');
        if (!actionControl || actionControl.value.trim().toLowerCase() !== 'save') {
            return { ok: false, reason: 'Private document save form is missing hidden action=save.' };
        }

        const docIdControl = form.querySelector<HTMLInputElement>('input[type="hidden"][name="docid"]');
        const formDocId = docIdControl?.value.trim() || '';
        if (!formDocId) {
            return { ok: false, reason: 'Private document save form is missing hidden docid.' };
        }
        if (formDocId !== docId) {
            return { ok: false, reason: `Private document form docid ${formDocId} did not match requested docid ${docId}.` };
        }

        const rawAction = form.getAttribute('action')?.trim();
        let parsedActionUrl: URL;
        try {
            parsedActionUrl = new URL(rawAction || requestUrl, requestUrl);
            parsedActionUrl.hash = '';
        } catch {
            return { ok: false, reason: 'Private document save form action URL is invalid.' };
        }
        const actionUrl = parsedActionUrl.href;

        if (parsedActionUrl.protocol !== 'https:' || !FFN_DOC_HOSTS.has(parsedActionUrl.hostname) || parsedActionUrl.pathname !== '/docs/edit.php') {
            return { ok: false, reason: 'Private document save form action did not target FFN /docs/edit.php.' };
        }

        const targetDocId = parsedActionUrl.searchParams.get('docid');
        if (targetDocId && targetDocId !== docId) {
            return { ok: false, reason: `Private document save target docid ${targetDocId} did not match requested docid ${docId}.` };
        }

        const currentHtml = textarea.value || textarea.textContent || '';
        const submittedHtml = options.replacementHtml !== undefined ? options.replacementHtml : currentHtml;
        if (!submittedHtml.trim()) {
            return {
                ok: false,
                reason: options.operationLabel === 'IMPORT'
                    ? 'Replacement content is empty.'
                    : 'Private document editor content is empty, so refresh was blocked.',
            };
        }

        const params = new URLSearchParams();
        Array.from(form.elements).forEach(element => appendSuccessfulControl(params, element));
        params.set(textareaName, submittedHtml);
        params.set('action', 'save');
        params.set('docid', docId);

        return {
            ok: true,
            actionUrl,
            body: params.toString(),
            submittedHtml,
        };
    },

    _verifyPrivateDocSaveResponse: function (
        response: FetchTextResponse,
        docId: string,
        submittedHtml: string,
        options: SavePrivateDocOptions
    ): PrivateDocSaveAttemptResult {
        const responseDoc = new DOMParser().parseFromString(response.responseText, 'text/html');

        const explicitFailure = this._getPrivateDocExplicitFailureReason(responseDoc, response);
        if (explicitFailure) {
            return { ok: false, reason: explicitFailure, retryable: false };
        }

        const successPanel = responseDoc.querySelector<HTMLElement>('.panel_success');
        const successText = normalizeText(successPanel?.textContent || '');
        if (/successfully\s+saved|success/i.test(successText)) {
            return { ok: true, retryable: false };
        }

        const textarea = this._getEditorTextarea(responseDoc);
        const form = this._getPrivateDocForm(responseDoc, textarea);
        const returnedDocId = form?.querySelector<HTMLInputElement>('input[type="hidden"][name="docid"]')?.value.trim() || '';
        if (returnedDocId && returnedDocId !== docId) {
            return {
                ok: false,
                reason: `FFN returned docid ${returnedDocId} instead of ${docId} after save verification.`,
                retryable: false,
            };
        }

        if (options.operationLabel === 'REFRESH') {
            const refreshedHtml = textarea ? (textarea.value || textarea.textContent || '').trim() : '';
            if (returnedDocId === docId && refreshedHtml) {
                return { ok: true, retryable: false };
            }

            return {
                ok: false,
                reason: 'FFN did not confirm the refresh save.',
                retryable: true,
            };
        }

        const returnedHtml = textarea ? (textarea.value || textarea.textContent || '') : '';
        if (returnedDocId === docId && this._normalizeEditorHtmlForComparison(returnedHtml) === this._normalizeEditorHtmlForComparison(submittedHtml)) {
            return { ok: true, retryable: false };
        }

        if (returnedDocId === docId && textarea) {
            return {
                ok: false,
                reason: 'FFN returned editor content that did not match the imported HTML.',
                retryable: true,
            };
        }

        return {
            ok: false,
            reason: 'FFN did not confirm the import save.',
            retryable: true,
        };
    },

    /**
     * Refreshes a document by loading the edit form, preserving the existing HTML,
     * and submitting the same FFN save payload through the service worker fetch path.
     */
    refreshPrivateDoc: async function (docId: string, title: string, attempt: number = 1): Promise<boolean> {
        const log = Core.getLogger(this.MODULE_NAME, 'refreshPrivateDoc');
        const maxRetries = SettingsManager.get('fetchMaxRetries');

        try {
            log(`[REFRESH START] Refreshing "${title}" (DocID: ${docId}, Attempt: ${attempt}/${maxRetries})`);
            const saveResult = await this._savePrivateDocDirectlyWithResult(docId, title, {
                operationLabel: 'REFRESH',
            });

            if (!saveResult.ok && saveResult.retryable && attempt < maxRetries) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[REFRESH] Save not confirmed for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.refreshPrivateDoc(docId, title, attempt + 1);
            }

            if (!saveResult.ok) {
                log(`[REFRESH FAILED] ${saveResult.reason || 'Unknown refresh failure.'}`);
            }
            return saveResult.ok;
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
        const result = await this.replacePrivateDocContentWithResult(docId, title, replacementHtml, attempt);
        return result.ok;
    },

    /**
     * Replaces private document content and returns a user-facing failure reason
     * when the operation cannot be completed.
     */
    replacePrivateDocContentWithResult: async function (
        docId: string,
        title: string,
        replacementHtml: string,
        attempt: number = 1,
    ): Promise<PrivateDocSaveResult> {
        const log = Core.getLogger(this.MODULE_NAME, 'replacePrivateDocContent');
        const maxRetries = SettingsManager.get('fetchMaxRetries');

        if (!replacementHtml.trim()) {
            log(`[IMPORT BLOCKED] Replacement content for "${title}" is empty.`);
            return { ok: false, reason: 'Replacement content is empty.' };
        }

        try {
            log(`[IMPORT START] Replacing "${title}" (DocID: ${docId}, Attempt: ${attempt}/${maxRetries})`);
            const saveResult = await this._savePrivateDocDirectlyWithResult(docId, title, {
                operationLabel: 'IMPORT',
                replacementHtml,
            });

            if (!saveResult.ok && saveResult.retryable && attempt < maxRetries) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[IMPORT] Save not confirmed for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.replacePrivateDocContentWithResult(docId, title, replacementHtml, attempt + 1);
            }

            return {
                ok: saveResult.ok,
                reason: saveResult.reason,
            };
        } catch (err) {
            log('[IMPORT ERROR] Exception during import save:', err);
            console.error(`IMPORT FAILED for document ${docId}:`, err);

            if (attempt < maxRetries) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[IMPORT] Exception occurred. Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.replacePrivateDocContentWithResult(docId, title, replacementHtml, attempt + 1);
            }

            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, reason: `Unexpected error: ${message}` };
        }
    },

    _savePrivateDocDirectly: async function (
        docId: string,
        title: string,
        options: SavePrivateDocOptions,
    ): Promise<boolean> {
        const result = await this._savePrivateDocDirectlyWithResult(docId, title, options);
        return result.ok;
    },

    /**
     * Shared direct-save implementation with structured failure reasons and retry metadata.
     */
    _savePrivateDocDirectlyWithResult: async function (
        docId: string,
        title: string,
        options: SavePrivateDocOptions,
    ): Promise<PrivateDocSaveAttemptResult> {
        const log = Core.getLogger(this.MODULE_NAME, '_savePrivateDocDirectlyWithResult');
        const editUrl = `https://www.fanfiction.net/docs/edit.php?docid=${encodeURIComponent(docId)}`;
        const label = options.operationLabel;

        if (options.replacementHtml !== undefined && !options.replacementHtml.trim()) {
            return { ok: false, reason: 'Replacement content is empty.', retryable: false };
        }

        log(`[${label}] Fetching private document edit page for "${title}".`);
        const editResponse = await fetchRequestText({
            method: 'GET',
            url: editUrl,
        });

        const editTransportFailure = this._getPrivateDocTransportFailure(editResponse, 'edit page request');
        if (editTransportFailure) return editTransportFailure;

        const editDoc = new DOMParser().parseFromString(editResponse.responseText, 'text/html');
        const editFailure = this._getPrivateDocExplicitFailureReason(editDoc, editResponse);
        if (editFailure) {
            return { ok: false, reason: editFailure, retryable: false };
        }

        const request = this._buildPrivateDocSaveRequest(editDoc, editUrl, docId, options);
        if (!request.ok || !request.actionUrl || request.body === undefined || request.submittedHtml === undefined) {
            return { ok: false, reason: request.reason || 'Could not build the private document save request.', retryable: false };
        }

        log(`[${label}] Posting private document save payload for "${title}".`);
        const saveResponse = await fetchRequestText({
            method: 'POST',
            url: request.actionUrl,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            data: request.body,
            timeout: SettingsManager.get('iframeSaveTimeoutMs'),
        });

        const saveTransportFailure = this._getPrivateDocTransportFailure(saveResponse, 'save request');
        if (saveTransportFailure) return saveTransportFailure;

        return this._verifyPrivateDocSaveResponse(saveResponse, docId, request.submittedHtml, options);
    },
};
