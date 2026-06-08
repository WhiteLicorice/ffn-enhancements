// services/DocFetchService.ts

import { Core } from '../modules/Core';
import { ContentParser } from './ContentParser';
import { SettingsManager } from '../modules/SettingsManager';
import { fetchWithBackoff } from '../utils/fetchWithBackoff';

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

interface PrivateDocDeleteAttemptResult extends PrivateDocSaveResult {
    retryable: boolean;
}

interface PrivateDocSavePreparationResult {
    ok: boolean;
    reason?: string;
    form?: HTMLFormElement;
    textarea?: HTMLTextAreaElement;
    actionUrl?: string;
    submittedHtml?: string;
}

const FFN_DOC_HOSTS = new Set(['www.fanfiction.net', 'fanfiction.net']);

/**
 * Encodes literal `~` characters as `&#126;` in text content only (not inside
 * HTML tags or attributes). This prevents FFN/marked from interpreting lone
 * tildes as strikethrough delimiters during round-trips.
 */
function encodeTildesForSave(html: string): string {
    // Split on HTML tags; odd indices are tags, even indices are text content.
    return html.replace(/([^<]*)(<[^>]*>)?/g, (_match, text: string, tag: string | undefined) => {
        const encoded = text ? text.replace(/~/g, '&#126;') : '';
        return encoded + (tag || '');
    });
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeFfnFailureText(value: string): string {
    const text = normalizeText(value);
    if (/invalid\s*request/i.test(text) && /unable\s*to\s*authenticate/i.test(text)) {
        return 'Invalid Request: We are unable to authenticate your request.';
    }
    return text;
}

function getReadableText(node: Node | null | undefined): string {
    if (!node) return '';

    const chunks: string[] = [];
    const blockTags = new Set([
        'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT',
        'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
        'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
        'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
    ]);

    const walk = (current: Node) => {
        if (current.nodeType === Node.TEXT_NODE) {
            chunks.push(current.textContent || '');
            return;
        }

        if (!(current instanceof Element)) {
            current.childNodes.forEach(walk);
            return;
        }

        const isBlock = blockTags.has(current.tagName);
        if (isBlock) chunks.push(' ');
        if (current.tagName === 'BR' || current.tagName === 'HR') {
            chunks.push(' ');
            return;
        }

        current.childNodes.forEach(walk);
        if (isBlock) chunks.push(' ');
    };

    walk(node);
    return normalizeFfnFailureText(chunks.join(''));
}

function isRetryableDeleteFailureReason(reason: string | undefined): boolean {
    if (!reason) return false;
    return /invalid\s*request|unable\s*to\s*authenticate|login|authorization|cloudflare|ddos protection|denied access/i.test(reason);
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

function hideFrame(frame: HTMLIFrameElement): void {
    frame.style.position = 'absolute';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.left = '-9999px';
    frame.style.top = '-9999px';
    frame.style.border = 'none';
    frame.style.visibility = 'hidden';
}

function createFrameName(prefix: string): string {
    const token = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return `${prefix}${token}`;
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
            .replace(/&#126;|&#x7[eE];|&tilde;/g, '~')
            .replace(/>\s+</g, '><')
            .replace(/\s+/g, ' ')
            .trim();
    },

    _getPrivateDocExplicitFailureReason: function (
        doc: Document,
        response?: {
            status?: number;
            isCfChallenge?: boolean;
            finalUrl?: string;
        }
    ): string | null {
        const bodyText = getReadableText(doc.body);
        const titleText = normalizeText(doc.title || '');
        if (
            response?.isCfChallenge
            || /cloudflare|checking\s+your\s+browser|ddos\s+protection/i.test(bodyText)
            || /cloudflare|just\s+a\s+moment/i.test(titleText)
        ) {
            return 'FFN save request was blocked by a Cloudflare challenge. Open fanfiction.net in this browser, clear the challenge, then retry.';
        }

        const errorPanel = doc.querySelector<HTMLElement>('.panel_error, .gui_error, .alert-error, .error');
        const errorText = getReadableText(errorPanel);
        if (errorText) return errorText;

        const finalUrlPath = normalizeUrlForComparison(response?.finalUrl);
        if (finalUrlPath && !finalUrlPath.endsWith('/docs/edit.php')) {
            if (/\/login\.php$/i.test(finalUrlPath)) {
                return 'FFN returned a login or authorization page.';
            }
        }

        if (/please\s+log\s*in|login\s+required|not\s+authorized|authorization\s+required|sign\s+in/i.test(bodyText)) {
            return 'FFN returned a login or authorization page.';
        }

        if (/invalid\s*request|unable\s*to\s*authenticate/i.test(bodyText)) {
            return normalizeFfnFailureText(bodyText);
        }

        if (response?.status === 403) {
            return 'FFN denied access to the document request.';
        }

        return null;
    },

    _getPrivateDocDeleteFailureReason: function (
        doc: Document,
        response?: {
            status?: number;
            isCfChallenge?: boolean;
            finalUrl?: string;
        }
    ): string | null {
        const reason = this._getPrivateDocExplicitFailureReason(doc, response);
        if (reason === 'FFN save request was blocked by a Cloudflare challenge. Open fanfiction.net in this browser, clear the challenge, then retry.') {
            return 'FFN delete request was blocked by a Cloudflare challenge. Open fanfiction.net in this browser, clear the challenge, then retry.';
        }
        return reason;
    },

    _docManagerPageContainsDocId: function (doc: Document, docId: string): boolean {
        const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="docid="]'));
        for (const link of links) {
            try {
                const parsed = new URL(link.href, 'https://www.fanfiction.net');
                if (parsed.searchParams.get('docid') === docId) return true;
            } catch {
                if (link.getAttribute('href')?.includes(`docid=${docId}`)) return true;
            }
        }

        const controls = Array.from(doc.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLOptionElement>(
            'input[name="docid"], select[name="docid"], option[value]'
        ));
        return controls.some(control => control.value === docId);
    },

    _verifyPrivateDocDeleteResponse: function (
        response: {
            ok: boolean;
            status: number;
            responseText: string;
            finalUrl?: string;
            isCfChallenge?: boolean;
        },
        docId: string,
    ): PrivateDocDeleteAttemptResult {
        const responseDoc = new DOMParser().parseFromString(response.responseText, 'text/html');

        const explicitFailure = this._getPrivateDocDeleteFailureReason(responseDoc, response);
        if (explicitFailure) {
            return {
                ok: false,
                reason: explicitFailure,
                retryable: isRetryableDeleteFailureReason(explicitFailure),
            };
        }

        const bodyText = getReadableText(responseDoc.body);
        if (!bodyText && !response.responseText.trim()) {
            return { ok: false, reason: 'FFN returned an empty delete response.', retryable: true };
        }

        if (!response.ok && response.status > 0) {
            return {
                ok: false,
                reason: `FFN delete request failed with HTTP ${response.status}.`,
                retryable: response.status === 403 || response.status === 429 || response.status >= 500,
            };
        }

        if (this._docManagerPageContainsDocId(responseDoc, docId)) {
            return {
                ok: false,
                reason: `FFN returned a DocManager page that still contains document ${docId}.`,
                retryable: true,
            };
        }

        return { ok: true, retryable: false };
    },

    _preparePrivateDocSaveForm: function (
        doc: Document,
        requestUrl: string,
        docId: string,
        options: SavePrivateDocOptions
    ): PrivateDocSavePreparationResult {
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

        if (parsedActionUrl.protocol !== 'https:' || !FFN_DOC_HOSTS.has(parsedActionUrl.hostname) || parsedActionUrl.pathname !== '/docs/edit.php') {
            return { ok: false, reason: 'Private document save form action did not target FFN /docs/edit.php.' };
        }

        if (parsedActionUrl.hostname === 'fanfiction.net') {
            parsedActionUrl.hostname = 'www.fanfiction.net';
        }

        const targetDocId = parsedActionUrl.searchParams.get('docid');
        if (targetDocId && targetDocId !== docId) {
            return { ok: false, reason: `Private document save target docid ${targetDocId} did not match requested docid ${docId}.` };
        }

        const actionUrl = parsedActionUrl.href;

        const currentHtml = textarea.value || textarea.textContent || '';
        const rawSubmittedHtml = options.replacementHtml !== undefined ? options.replacementHtml : currentHtml;
        if (!rawSubmittedHtml.trim()) {
            return {
                ok: false,
                reason: options.operationLabel === 'IMPORT'
                    ? 'Replacement content is empty.'
                    : 'Private document editor content is empty, so refresh was blocked.',
            };
        }

        const submittedHtml = encodeTildesForSave(rawSubmittedHtml);

        textarea.value = submittedHtml;

        form.method = 'post';
        form.action = actionUrl;
        form.target = '_self';

        return {
            ok: true,
            form,
            textarea,
            actionUrl,
            submittedHtml,
        };
    },

    _verifyPrivateDocSaveResponse: function (
        response: {
            ok: boolean;
            status: number;
            responseText: string;
            finalUrl?: string;
            isCfChallenge?: boolean;
        },
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

    _submitPrivateDocSaveFrame: function (
        editUrl: string,
        docId: string,
        title: string,
        options: SavePrivateDocOptions
    ): Promise<PrivateDocSaveAttemptResult> {
        const log = Core.getLogger(this.MODULE_NAME, '_submitPrivateDocSaveFrame');

        return new Promise<PrivateDocSaveAttemptResult>((resolve) => {
            let settled = false;
            let timeoutId: number | null = null;
            let submittedHtml: string | undefined;
            const iframe = document.createElement('iframe');
            iframe.name = createFrameName('ffne_doc_save_');
            iframe.setAttribute('sandbox', 'allow-same-origin allow-forms');
            hideFrame(iframe);
            iframe.src = editUrl;

            const cleanup = () => {
                if (timeoutId !== null) window.clearTimeout(timeoutId);
                iframe.removeEventListener('load', onLoad);
                iframe.remove();
            };

            const resolveOnce = (result: PrivateDocSaveAttemptResult) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(result);
            };

            const armTimeout = (ms: number, reason: string) => {
                if (timeoutId !== null) window.clearTimeout(timeoutId);
                timeoutId = window.setTimeout(() => {
                    resolveOnce({
                        ok: false,
                        reason,
                        retryable: true,
                    });
                }, ms);
            };

            const onLoad = () => {
                try {
                    const frameWindow = iframe.contentWindow;
                    const responseDoc = iframe.contentDocument;
                    if (!frameWindow || !responseDoc) {
                        resolveOnce({
                            ok: false,
                            reason: 'Hidden edit-page iframe was not readable.',
                            retryable: true,
                        });
                        return;
                    }

                    const currentHref = frameWindow.location.href || responseDoc.URL || '';
                    const frameHref = currentHref && currentHref !== 'about:blank' ? currentHref : iframe.src || '';
                    const bodyText = normalizeText(responseDoc.body?.textContent || '');
                    if ((!frameHref || frameHref === 'about:blank') && !bodyText) return;

                    if (submittedHtml === undefined) {
                        const initialFailure = this._getPrivateDocExplicitFailureReason(responseDoc, {
                            finalUrl: frameHref,
                        });
                        if (initialFailure) {
                            resolveOnce({ ok: false, reason: initialFailure, retryable: false });
                            return;
                        }

                        const prepared = this._preparePrivateDocSaveForm(responseDoc, frameHref || editUrl, docId, options);
                        if (!prepared.ok || !prepared.form || prepared.submittedHtml === undefined) {
                            resolveOnce({
                                ok: false,
                                reason: prepared.reason || 'Could not prepare the private document save form.',
                                retryable: false,
                            });
                            return;
                        }

                        submittedHtml = prepared.submittedHtml;
                        log(`[${options.operationLabel}] Submitting real edit-page save form for "${title}".`);
                        armTimeout(SettingsManager.get('iframeSaveTimeoutMs'), 'Request timed out.');
                        prepared.form.submit();
                        return;
                    }

                    resolveOnce(this._verifyPrivateDocSaveResponse(
                        {
                            ok: true,
                            status: 200,
                            responseText: responseDoc.documentElement?.outerHTML || responseDoc.body?.outerHTML || '',
                            finalUrl: frameHref,
                            isCfChallenge: false,
                        },
                        docId,
                        submittedHtml,
                        options
                    ));
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    log('Could not inspect hidden private document edit frame.', message);
                    resolveOnce({
                        ok: false,
                        reason: `Could not inspect hidden private document edit frame: ${message}`,
                        retryable: true,
                    });
                }
            };

            try {
                const mountPoint = document.body || document.documentElement;
                if (!mountPoint) {
                    resolveOnce({
                        ok: false,
                        reason: 'Could not mount the hidden edit-page iframe.',
                        retryable: false,
                    });
                    return;
                }

                iframe.addEventListener('load', onLoad);
                mountPoint.append(iframe);
                armTimeout(SettingsManager.get('iframeLoadTimeoutMs'), 'Edit page load timed out.');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log('Could not create hidden private document edit iframe.', message);
                resolveOnce({
                    ok: false,
                    reason: `Could not create hidden private document edit iframe: ${message}`,
                    retryable: true,
                });
            }
        });
    },

    _fetchPrivateDocDeleteWithResult: async function (
        removeUrl: string,
        docId: string,
        title: string,
    ): Promise<PrivateDocDeleteAttemptResult> {
        const log = Core.getLogger(this.MODULE_NAME, '_fetchPrivateDocDeleteWithResult');

        try {
            const response = await fetch(removeUrl, {
                credentials: 'include',
                redirect: 'follow',
            });
            const responseText = await response.text();
            log(`[DELETE] Loaded remove response for "${title}".`, {
                status: response.status,
                finalUrl: response.url,
            });

            return this._verifyPrivateDocDeleteResponse(
                {
                    ok: response.ok,
                    status: response.status,
                    responseText,
                    finalUrl: response.url,
                    isCfChallenge: false,
                },
                docId,
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`Delete request failed for "${title}".`, message);
            return {
                ok: false,
                reason: `Delete request failed: ${message}`,
                retryable: true,
            };
        }
    },

    /**
     * Refreshes a document by loading the edit page in a hidden no-script iframe,
     * preserving the existing HTML, and submitting FFN's real save form.
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
     * Deletes a private document through FFN's existing remove endpoint and
     * verifies the returned DocManager page no longer exposes the deleted docid.
     */
    deletePrivateDocWithResult: async function (
        docId: string,
        title: string,
        attempt: number = 1,
    ): Promise<PrivateDocSaveResult> {
        const log = Core.getLogger(this.MODULE_NAME, 'deletePrivateDocWithResult');
        const maxRetries = SettingsManager.get('fetchMaxRetries');
        const removeUrl = `https://www.fanfiction.net/docs/docs.php?action=remove&docid=${encodeURIComponent(docId)}`;

        try {
            log(`[DELETE START] Deleting "${title}" (DocID: ${docId}, Attempt: ${attempt}/${maxRetries})`);
            const deleteResult = await this._fetchPrivateDocDeleteWithResult(removeUrl, docId, title);

            if (!deleteResult.ok && deleteResult.retryable && attempt < maxRetries) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[DELETE] Delete not confirmed for "${title}". Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.deletePrivateDocWithResult(docId, title, attempt + 1);
            }

            return {
                ok: deleteResult.ok,
                reason: deleteResult.reason,
            };
        } catch (err) {
            log('[DELETE ERROR] Exception during delete:', err);
            console.error(`DELETE FAILED for document ${docId}:`, err);

            if (attempt < maxRetries) {
                const waitTime = attempt * SettingsManager.get('fetchRetryBaseMs');
                log(`[DELETE] Exception occurred. Retrying in ${waitTime}ms... (Attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                return this.deletePrivateDocWithResult(docId, title, attempt + 1);
            }

            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, reason: `Unexpected error: ${message}` };
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

        log(`[${label}] Loading hidden private document edit frame for "${title}".`);
        return this._submitPrivateDocSaveFrame(editUrl, docId, title, options);
    },
};
