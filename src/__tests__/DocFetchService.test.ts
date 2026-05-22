import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/fetchRequest', () => ({
    fetchRequestText: vi.fn(),
}));

import { SettingsManager } from '../modules/SettingsManager';
import { DocFetchService } from '../services/DocFetchService';
import { fetchRequestText } from '../utils/fetchRequest';

const fetchRequestTextMock = vi.mocked(fetchRequestText);
const EDIT_URL = 'https://www.fanfiction.net/docs/edit.php?docid=123';

function makeEditPage(options: {
    docId?: string;
    action?: string | null;
    textareaName?: string;
    textareaValue?: string;
    extraControls?: string;
} = {}): string {
    const {
        docId = '123',
        action = '/docs/edit.php?docid=123',
        textareaName = 'bio',
        textareaValue = 'Existing content',
        extraControls = '',
    } = options;
    const actionAttribute = action === null ? '' : ` action="${action}"`;

    return `
        <form name="docform" method="post"${actionAttribute}>
            <textarea name="${textareaName}">${textareaValue}</textarea>
            <input type="hidden" name="action" value="save">
            <input type="hidden" name="docid" value="${docId}">
            <select name="selectdocid">
                <option value="777">Other</option>
                <option value="${docId}" selected>Selected</option>
            </select>
            <input type="hidden" name="csrf" value="token-123">
            <input type="hidden" name="arbitrary" value="keep-me">
            <input type="checkbox" name="keep" value="yes" checked>
            <input type="checkbox" name="skip" value="no">
            <button type="submit">Save</button>
            ${extraControls}
        </form>
    `;
}

function writeFrameHtml(
    iframe: HTMLIFrameElement,
    html: string,
    url: string = EDIT_URL,
) {
    iframe.src = url;
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Missing iframe document');
    doc.open();
    doc.write(html);
    doc.close();
}

function getSaveFrame(): HTMLIFrameElement {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[name^="ffne_doc_save_"]');
    if (!iframe) throw new Error('Expected hidden save iframe to exist.');
    return iframe;
}

function mockIframeFormSubmit(
    iframe: HTMLIFrameElement,
    handler: (form: HTMLFormElement, iframe: HTMLIFrameElement) => void,
) {
    const frameWindow = iframe.contentWindow as (Window & typeof globalThis) | null;
    const framePrototype = frameWindow?.HTMLFormElement.prototype;
    if (!framePrototype) throw new Error('Missing iframe form prototype');
    return vi.spyOn(framePrototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
        handler(this, iframe);
    });
}

describe('DocFetchService guard helpers', () => {
    it('returns trimmed editor textarea content when present', () => {
        const doc = new DOMParser().parseFromString(
            '<textarea name="bio">  Existing content  </textarea>',
            'text/html'
        );

        expect(DocFetchService._getEditorContentForGuard(doc)).toBe('Existing content');
    });

    it('supports the webcontent editor textarea variant', () => {
        const doc = new DOMParser().parseFromString(
            '<textarea name="webcontent">  Replacement target  </textarea>',
            'text/html'
        );

        expect(DocFetchService._getEditorContentForGuard(doc)).toBe('Replacement target');
    });

    it('returns null when the editor textarea is missing', () => {
        const doc = new DOMParser().parseFromString('<div>No editor</div>', 'text/html');

        expect(DocFetchService._getEditorContentForGuard(doc)).toBeNull();
    });
});

describe('DocFetchService direct save helpers', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        fetchRequestTextMock.mockReset();
        vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
            switch (key) {
                case 'fetchMaxRetries':
                    return 1 as never;
                case 'fetchRetryBaseMs':
                    return 0 as never;
                case 'iframeSaveTimeoutMs':
                    return 4321 as never;
                default:
                    return 0 as never;
            }
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('prepares the real iframe docform and overwrites only the editor textarea for import', () => {
        const doc = new DOMParser().parseFromString(makeEditPage({
            extraControls: '<input type="radio" name="mode" value="html" checked>',
        }), 'text/html');

        const result = DocFetchService._preparePrivateDocSaveForm(doc, EDIT_URL, '123', {
            operationLabel: 'IMPORT',
            replacementHtml: '<p>Imported</p>',
        });

        expect(result.ok).toBe(true);
        expect(result.form).toBe(doc.querySelector('form[name="docform"]'));
        expect(result.textarea?.value).toBe('<p>Imported</p>');
        expect(result.submittedHtml).toBe('<p>Imported</p>');
        expect(result.form?.querySelector<HTMLInputElement>('input[name="csrf"]')?.value).toBe('token-123');
        expect(result.form?.querySelector<HTMLInputElement>('input[name="arbitrary"]')?.value).toBe('keep-me');
        expect(result.form?.querySelector<HTMLInputElement>('input[name="action"]')?.value).toBe('save');
        expect(result.form?.querySelector<HTMLInputElement>('input[name="docid"]')?.value).toBe('123');
        expect(result.form?.querySelector<HTMLInputElement>('input[name="keep"]')?.checked).toBe(true);
        expect(result.form?.querySelector<HTMLInputElement>('input[name="skip"]')?.checked).toBe(false);
        expect(result.form?.querySelector<HTMLInputElement>('input[name="mode"]')?.checked).toBe(true);
    });

    it('preserves the existing editor textarea value for refresh requests', () => {
        const doc = new DOMParser().parseFromString(makeEditPage(), 'text/html');

        const result = DocFetchService._preparePrivateDocSaveForm(doc, EDIT_URL, '123', {
            operationLabel: 'REFRESH',
        });

        expect(result.ok).toBe(true);
        expect(result.textarea?.value).toBe('Existing content');
        expect(result.submittedHtml).toBe('Existing content');
    });

    it('defaults a missing form action to the requested edit URL', () => {
        const doc = new DOMParser().parseFromString(makeEditPage({ action: null }), 'text/html');

        const result = DocFetchService._preparePrivateDocSaveForm(doc, EDIT_URL, '123', {
            operationLabel: 'REFRESH',
        });

        expect(result.ok).toBe(true);
    });

    it('accepts either canonical FFN host for form actions', () => {
        const doc = new DOMParser().parseFromString(makeEditPage({
            action: 'https://fanfiction.net/docs/edit.php?docid=123',
        }), 'text/html');

        const result = DocFetchService._preparePrivateDocSaveForm(doc, EDIT_URL, '123', {
            operationLabel: 'REFRESH',
        });

        expect(result.ok).toBe(true);
    });

    it('loads the edit page in a sandboxed iframe and submits the real iframe docform', async () => {
        const clickSpy = vi.spyOn(HTMLElement.prototype, 'click');
        const intervalSpy = vi.spyOn(window, 'setInterval');
        const promise = DocFetchService.refreshPrivateDoc('123', 'Doc Name');
        const iframe = getSaveFrame();
        writeFrameHtml(iframe, makeEditPage());
        const submitSpy = mockIframeFormSubmit(iframe, (form, frame) => {
            expect(form).toBe(frame.contentDocument?.querySelector('form[name="docform"]'));
            expect(form.method).toBe('post');
            expect(form.action).toBe(EDIT_URL);
            expect((form.elements.namedItem('bio') as HTMLTextAreaElement).value).toBe('Existing content');
            expect((form.elements.namedItem('action') as HTMLInputElement).value).toBe('save');
            expect((form.elements.namedItem('docid') as HTMLInputElement).value).toBe('123');
            expect((form.elements.namedItem('arbitrary') as HTMLInputElement).value).toBe('keep-me');

            writeFrameHtml(frame, '<div class="panel_success">Document successfully saved.</div>');
            frame.dispatchEvent(new Event('load'));
        });

        expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin allow-forms');
        expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');
        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toBe(true);
        expect(fetchRequestTextMock).not.toHaveBeenCalled();
        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(clickSpy).not.toHaveBeenCalled();
        expect(intervalSpy).not.toHaveBeenCalled();
        expect(document.querySelector('iframe[name^="ffne_doc_save_"]')).toBeNull();
        expect(document.querySelector('form[target^="ffne_doc_save_"]')).toBeNull();
    });

    it('fails when the loaded iframe form belongs to the wrong doc', async () => {
        const promise = DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');
        const iframe = getSaveFrame();
        writeFrameHtml(iframe, makeEditPage({ docId: '999', action: '/docs/edit.php?docid=999' }));
        const submitSpy = mockIframeFormSubmit(iframe, () => {
            throw new Error('submit should not be called');
        });

        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toEqual({
            ok: false,
            reason: 'Private document form docid 999 did not match requested docid 123.',
        });
        expect(fetchRequestTextMock).not.toHaveBeenCalled();
        expect(submitSpy).not.toHaveBeenCalled();
    });

    it('fails refresh when the iframe editor content is empty', async () => {
        const promise = DocFetchService.refreshPrivateDoc('123', 'Doc Name');
        const iframe = getSaveFrame();
        writeFrameHtml(iframe, makeEditPage({ textareaValue: '   ' }));
        const submitSpy = mockIframeFormSubmit(iframe, () => {
            throw new Error('submit should not be called');
        });

        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toBe(false);
        expect(fetchRequestTextMock).not.toHaveBeenCalled();
        expect(submitSpy).not.toHaveBeenCalled();
    });

    it('normalizes bare FFN host form actions to the same-origin www host', () => {
        const doc = new DOMParser().parseFromString(makeEditPage({
            action: 'https://fanfiction.net/docs/edit.php?docid=123',
        }), 'text/html');

        const result = DocFetchService._buildPrivateDocSaveRequest(doc, 'https://www.fanfiction.net/docs/edit.php?docid=123', '123', {
            operationLabel: 'REFRESH',
        });

        expect(result.ok).toBe(true);
        expect(result.actionUrl).toBe('https://www.fanfiction.net/docs/edit.php?docid=123');
    });

    it('keeps canonical www FFN host form actions unchanged', () => {
        const doc = new DOMParser().parseFromString(makeEditPage({
            action: 'https://www.fanfiction.net/docs/edit.php?docid=123',
        }), 'text/html');

        const result = DocFetchService._buildPrivateDocSaveRequest(doc, 'https://www.fanfiction.net/docs/edit.php?docid=123', '123', {
            operationLabel: 'REFRESH',
        });

        expect(result.ok).toBe(true);
        expect(result.actionUrl).toBe('https://www.fanfiction.net/docs/edit.php?docid=123');
    });

    it('aborts before POST when the editor textarea has no name', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage({ textareaName: '' }),
        }));

        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toEqual({
            ok: false,
            reason: 'Private document editor textarea is missing a name.',
        });
    });

    it('fails when the editor textarea is missing', async () => {
        const promise = DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');
        const iframe = getSaveFrame();
        writeFrameHtml(iframe, '<form name="docform"><input type="hidden" name="action" value="save"><input type="hidden" name="docid" value="123"></form>');

        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toEqual({
            ok: false,
            reason: 'Could not find the private document editor textarea.',
        });
    });

    it('fails before loading any iframe when replacement HTML is empty', async () => {
        await expect(DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '   ')).resolves.toEqual({
            ok: false,
            reason: 'Replacement content is empty.',
        });
        expect(fetchRequestTextMock).not.toHaveBeenCalled();
        expect(document.querySelector('iframe[name^="ffne_doc_save_"]')).toBeNull();
    });

    it('fails when the save target is not FFN docs/edit.php', async () => {
        const promise = DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');
        const iframe = getSaveFrame();
        writeFrameHtml(iframe, makeEditPage({ action: '/docs/view.php?docid=123' }));

        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toEqual({
            ok: false,
            reason: 'Private document save form action did not target FFN /docs/edit.php.',
        });
    });

    it('accepts a clean refresh response with the same docid and non-empty textarea', async () => {
        const promise = DocFetchService.refreshPrivateDoc('123', 'Doc Name');
        const iframe = getSaveFrame();
        writeFrameHtml(iframe, makeEditPage({ textareaValue: 'Existing content' }));
        mockIframeFormSubmit(iframe, (_form, frame) => {
            writeFrameHtml(frame, makeEditPage({ textareaValue: 'Existing content' }));
            frame.dispatchEvent(new Event('load'));
        });

        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toBe(true);
    });

    it('accepts an import response when the returned textarea matches the submitted HTML after normalization', async () => {
        const promise = DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>\n<div>Body</div>');
        const iframe = getSaveFrame();
        writeFrameHtml(iframe, makeEditPage());
        mockIframeFormSubmit(iframe, (form, frame) => {
            expect((form.elements.namedItem('bio') as HTMLTextAreaElement).value).toBe('<p>Imported</p>\n<div>Body</div>');
            writeFrameHtml(frame, makeEditPage({ textareaValue: '<p>Imported</p>\r\n<div>Body</div>' }));
            frame.dispatchEvent(new Event('load'));
        });

        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toEqual({ ok: true, reason: undefined });
    });

    it('fails safely on invalid-auth iframe responses without retrying', async () => {
        vi.mocked(SettingsManager.get).mockImplementation((key) => {
            switch (key) {
                case 'fetchMaxRetries':
                    return 2 as never;
                case 'fetchRetryBaseMs':
                    return 0 as never;
                case 'iframeSaveTimeoutMs':
                    return 4321 as never;
                default:
                    return 0 as never;
            }
        });

        const promise = DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');
        const iframe = getSaveFrame();
        writeFrameHtml(iframe, makeEditPage());
        const submitSpy = mockIframeFormSubmit(iframe, (_form, frame) => {
            writeFrameHtml(frame, '<body>Invalid Request / unable to authenticate</body>');
            frame.dispatchEvent(new Event('load'));
        });

        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toEqual({
            ok: false,
            reason: 'Invalid Request / unable to authenticate.',
        });
        expect(fetchRequestTextMock).not.toHaveBeenCalled();
        expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    it('fails safely on login iframe responses without retrying', async () => {
        const promise = DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');
        const iframe = getSaveFrame();
        writeFrameHtml(iframe, makeEditPage());
        mockIframeFormSubmit(iframe, (_form, frame) => {
            writeFrameHtml(frame, '<body>Please log in to continue.</body>', 'https://www.fanfiction.net/login.php');
            frame.dispatchEvent(new Event('load'));
        });

        iframe.dispatchEvent(new Event('load'));

        await expect(promise).resolves.toEqual({
            ok: false,
            status: 403,
            responseText: 'DDoS protection by Cloudflare',
            isCfChallenge: true,
        }));

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result.ok).toBe(false);
        expect(result.reason).toContain('Cloudflare');
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
    });

    it('fails safely on Cloudflare-like iframe responses without retrying', async () => {
        vi.mocked(SettingsManager.get).mockImplementation((key) => {
            switch (key) {
                case 'fetchMaxRetries':
                    return 2 as never;
                case 'fetchRetryBaseMs':
                    return 0 as never;
                case 'iframeSaveTimeoutMs':
                    return 4321 as never;
                default:
                    return 0 as never;
            }
        });
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage(),
        }));
        const submitSpy = mockNativeSaveSubmission((_form, iframe) => {
            writeFrameHtml(iframe, '<title>Just a moment...</title><body>Checking your browser before accessing fanfiction.net. Cloudflare</body>');
            iframe.dispatchEvent(new Event('load'));
        });

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result.ok).toBe(false);
        expect(result.reason).toContain('Cloudflare');
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
        expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    it('fails safely and cleans up when the save response iframe is unreadable', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage(),
        }));
        const submitSpy = mockNativeSaveSubmission((_form, iframe) => {
            Object.defineProperty(iframe, 'contentDocument', {
                configurable: true,
                get: () => null,
            });
            iframe.dispatchEvent(new Event('load'));
        });

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'Hidden save response frame was not readable.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(document.querySelector('iframe[name^="ffne_doc_save_"]')).toBeNull();
        expect(document.querySelector('form[target^="ffne_doc_save_"]')).toBeNull();
    });

    it('retries import mismatch failures and returns the mismatch reason after retry exhaustion', async () => {
        vi.mocked(SettingsManager.get).mockImplementation((key) => {
            switch (key) {
                case 'fetchMaxRetries':
                    return 2 as never;
                case 'fetchRetryBaseMs':
                    return 0 as never;
                case 'iframeSaveTimeoutMs':
                    return 4321 as never;
                default:
                    return 0 as never;
            }
        });
        fetchRequestTextMock
            .mockResolvedValueOnce(makeFetchResponse({ responseText: makeEditPage() }))
            .mockResolvedValueOnce(makeFetchResponse({ responseText: makeEditPage() }));
        const submitSpy = mockNativeSaveSubmission((_form, iframe) => {
            writeFrameHtml(iframe, makeEditPage({ textareaValue: '<p>Wrong</p>' }));
            iframe.dispatchEvent(new Event('load'));
        });

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'Hidden edit-page iframe was not readable.',
        });
        expect(document.querySelector('iframe[name^="ffne_doc_save_"]')).toBeNull();
    });

    it('cleans up the hidden iframe after response timeouts', async () => {
        vi.useFakeTimers();
        vi.mocked(SettingsManager.get).mockImplementation((key) => {
            switch (key) {
                case 'fetchMaxRetries':
                    return 1 as never;
                case 'fetchRetryBaseMs':
                    return 0 as never;
                case 'iframeSaveTimeoutMs':
                    return 10 as never;
                default:
                    return 0 as never;
            }
        });

        const promise = DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');
        await vi.advanceTimersByTimeAsync(10);

        await expect(promise).resolves.toEqual({
            ok: false,
            reason: 'Request timed out.',
        });
        expect(fetchRequestTextMock).not.toHaveBeenCalled();
        expect(document.querySelector('iframe[name^="ffne_doc_save_"]')).toBeNull();
    });
});
