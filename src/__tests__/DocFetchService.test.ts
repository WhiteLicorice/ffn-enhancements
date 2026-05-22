import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/fetchRequest', () => ({
    fetchRequestText: vi.fn(),
}));

import { SettingsManager } from '../modules/SettingsManager';
import { DocFetchService } from '../services/DocFetchService';
import { fetchRequestText } from '../utils/fetchRequest';

const fetchRequestTextMock = vi.mocked(fetchRequestText);

function makeFetchResponse(overrides: Partial<Awaited<ReturnType<typeof fetchRequestText>>> = {}) {
    return {
        ok: true,
        status: 200,
        responseText: '',
        finalUrl: 'https://www.fanfiction.net/docs/edit.php?docid=123',
        isCfChallenge: false,
        ...overrides,
    };
}

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
        <form name="docform"${actionAttribute}>
            <textarea name="${textareaName}">${textareaValue}</textarea>
            <input type="hidden" name="action" value="save">
            <input type="hidden" name="docid" value="${docId}">
            <select name="selectdocid">
                <option value="777">Other</option>
                <option value="${docId}" selected>Selected</option>
            </select>
            <input type="hidden" name="csrf" value="token-123">
            <input type="checkbox" name="keep" value="yes" checked>
            <input type="checkbox" name="skip" value="no">
            <button type="submit">Save</button>
            ${extraControls}
        </form>
    `;
}

function getControlValues(
    controls: Array<{ name: string; value: string; tagName: string }> | undefined,
    name: string
): string[] {
    return (controls || []).filter(control => control.name === name).map(control => control.value);
}

function getControl(
    controls: Array<{ name: string; value: string; tagName: string }> | undefined,
    name: string
) {
    return (controls || []).find(control => control.name === name);
}

function writeFrameHtml(iframe: HTMLIFrameElement, html: string) {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Missing iframe document');
    doc.open();
    doc.write(html);
    doc.close();
}

function mockNativeSaveSubmission(
    handler: (form: HTMLFormElement, iframe: HTMLIFrameElement) => void
) {
    return vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
        const iframe = document.querySelector(`iframe[name="${this.target}"]`) as HTMLIFrameElement | null;
        if (!iframe) throw new Error(`Missing iframe for target ${this.target}`);
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

    it('serializes FFN save controls and overwrites only bio for import', () => {
        const doc = new DOMParser().parseFromString(makeEditPage({
            extraControls: '<input type="radio" name="mode" value="html" checked>',
        }), 'text/html');

        const result = DocFetchService._buildPrivateDocSaveRequest(doc, 'https://www.fanfiction.net/docs/edit.php?docid=123', '123', {
            operationLabel: 'IMPORT',
            replacementHtml: '<p>Imported</p>',
        });

        expect(result.ok).toBe(true);
        expect(result.actionUrl).toBe('https://www.fanfiction.net/docs/edit.php?docid=123');
        expect(getControl(result.controls, 'bio')).toEqual({
            name: 'bio',
            value: '<p>Imported</p>',
            tagName: 'textarea',
        });
        expect(getControlValues(result.controls, 'action')).toEqual(['save']);
        expect(getControlValues(result.controls, 'docid')).toEqual(['123']);
        expect(getControlValues(result.controls, 'selectdocid')).toEqual(['123']);
        expect(getControlValues(result.controls, 'csrf')).toEqual(['token-123']);
        expect(getControlValues(result.controls, 'keep')).toEqual(['yes']);
        expect(getControlValues(result.controls, 'mode')).toEqual(['html']);
        expect(getControlValues(result.controls, 'skip')).toEqual([]);
    });

    it('preserves the parsed editor HTML for refresh requests', () => {
        const doc = new DOMParser().parseFromString(makeEditPage(), 'text/html');

        const result = DocFetchService._buildPrivateDocSaveRequest(doc, 'https://www.fanfiction.net/docs/edit.php?docid=123', '123', {
            operationLabel: 'REFRESH',
        });

        expect(result.ok).toBe(true);
        expect(getControl(result.controls, 'bio')).toEqual({
            name: 'bio',
            value: 'Existing content',
            tagName: 'textarea',
        });
    });

    it('submits a native hidden form to a sandboxed iframe and avoids the old hidden editor path', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage(),
        }));
        const clickSpy = vi.spyOn(HTMLElement.prototype, 'click');
        const intervalSpy = vi.spyOn(window, 'setInterval');
        const submitSpy = mockNativeSaveSubmission((form, iframe) => {
            expect(form.method).toBe('post');
            expect(form.action).toBe('https://www.fanfiction.net/docs/edit.php?docid=123');
            expect(form.target).toMatch(/^ffne_doc_save_/);
            expect((form.elements.namedItem('bio') as HTMLTextAreaElement).value).toBe('Existing content');
            expect((form.elements.namedItem('action') as HTMLInputElement).value).toBe('save');
            expect((form.elements.namedItem('docid') as HTMLInputElement).value).toBe('123');
            expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin');
            expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');

            writeFrameHtml(iframe, '<div class="panel_success">Document successfully saved.</div>');
            iframe.dispatchEvent(new Event('load'));
        });

        const result = await DocFetchService.refreshPrivateDoc('123', 'Doc Name');

        expect(result).toBe(true);
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
        expect(fetchRequestTextMock).toHaveBeenCalledWith({
            method: 'GET',
            url: 'https://www.fanfiction.net/docs/edit.php?docid=123',
        });
        expect(fetchRequestTextMock.mock.calls.some(([request]) => request.method === 'POST')).toBe(false);
        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(clickSpy).not.toHaveBeenCalled();
        expect(intervalSpy).not.toHaveBeenCalled();
        expect(document.querySelector('iframe[name^="ffne_doc_save_"]')).toBeNull();
        expect(document.querySelector('form[target^="ffne_doc_save_"]')).toBeNull();
    });

    it('aborts before POST when the fetched form belongs to the wrong doc', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage({ docId: '999', action: '/docs/edit.php?docid=999' }),
        }));

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'Private document form docid 999 did not match requested docid 123.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
    });

    it('aborts refresh before POST when the fetched editor content is empty', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage({ textareaValue: '   ' }),
        }));

        const result = await DocFetchService.refreshPrivateDoc('123', 'Doc Name');

        expect(result).toBe(false);
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
    });

    it('defaults a missing form action to the fetched edit URL', () => {
        const doc = new DOMParser().parseFromString(makeEditPage({
            action: null,
        }), 'text/html');

        const result = DocFetchService._buildPrivateDocSaveRequest(doc, 'https://www.fanfiction.net/docs/edit.php?docid=123', '123', {
            operationLabel: 'REFRESH',
        });

        expect(result.ok).toBe(true);
        expect(result.actionUrl).toBe('https://www.fanfiction.net/docs/edit.php?docid=123');
        expect(getControl(result.controls, 'bio')).toEqual({
            name: 'bio',
            value: 'Existing content',
            tagName: 'textarea',
        });
    });

    it('accepts either canonical FFN host for form actions', () => {
        const doc = new DOMParser().parseFromString(makeEditPage({
            action: 'https://fanfiction.net/docs/edit.php?docid=123',
        }), 'text/html');

        const result = DocFetchService._buildPrivateDocSaveRequest(doc, 'https://www.fanfiction.net/docs/edit.php?docid=123', '123', {
            operationLabel: 'REFRESH',
        });

        expect(result.ok).toBe(true);
        expect(result.actionUrl).toBe('https://fanfiction.net/docs/edit.php?docid=123');
    });

    it('aborts before POST when the editor textarea has no name', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage({ textareaName: '' }),
        }));

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'Private document editor textarea is missing a name.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
    });

    it('aborts before submit when the editor textarea is missing', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: '<form name="docform"><input type="hidden" name="action" value="save"><input type="hidden" name="docid" value="123"></form>',
        }));
        const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit');

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'Could not find the private document editor textarea.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
        expect(submitSpy).not.toHaveBeenCalled();
    });

    it('aborts import before any fetch when replacement HTML is empty', async () => {
        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '   ');

        expect(result).toEqual({
            ok: false,
            reason: 'Replacement content is empty.',
        });
        expect(fetchRequestTextMock).not.toHaveBeenCalled();
    });

    it('aborts before POST when the save target is not FFN docs/edit.php', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage({ action: '/docs/view.php?docid=123' }),
        }));

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'Private document save form action did not target FFN /docs/edit.php.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
    });

    it('accepts an explicit FFN success response for refresh', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage(),
        }));
        mockNativeSaveSubmission((_form, iframe) => {
            writeFrameHtml(iframe, '<div class="panel_success">Success! Document successfully saved.</div>');
            iframe.dispatchEvent(new Event('load'));
        });

        await expect(DocFetchService.refreshPrivateDoc('123', 'Doc Name')).resolves.toBe(true);
    });

    it('accepts mixed-case explicit success text for refresh', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage(),
        }));
        mockNativeSaveSubmission((_form, iframe) => {
            writeFrameHtml(iframe, '<div class="panel_success">SuCcEsS</div>');
            iframe.dispatchEvent(new Event('load'));
        });

        await expect(DocFetchService.refreshPrivateDoc('123', 'Doc Name')).resolves.toBe(true);
    });

    it('accepts a clean refresh response with the same docid and non-empty textarea', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage({ textareaValue: 'Existing content' }),
        }));
        mockNativeSaveSubmission((_form, iframe) => {
            writeFrameHtml(iframe, makeEditPage({ textareaValue: 'Existing content' }));
            iframe.dispatchEvent(new Event('load'));
        });

        await expect(DocFetchService.refreshPrivateDoc('123', 'Doc Name')).resolves.toBe(true);
    });

    it('accepts an import response when the returned textarea matches the submitted HTML after normalization', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage(),
        }));
        mockNativeSaveSubmission((form, iframe) => {
            expect((form.elements.namedItem('bio') as HTMLTextAreaElement).value).toBe('<p>Imported</p>\n<div>Body</div>');
            writeFrameHtml(iframe, makeEditPage({ textareaValue: '<p>Imported</p>\r\n<div>Body</div>' }));
            iframe.dispatchEvent(new Event('load'));
        });

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>\n<div>Body</div>');

        expect(result).toEqual({ ok: true, reason: undefined });
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
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
            responseText: makeEditPage(),
        }));
        const submitSpy = mockNativeSaveSubmission((_form, iframe) => {
            writeFrameHtml(iframe, '<body>Invalid Request / unable to authenticate</body>');
            iframe.dispatchEvent(new Event('load'));
        });

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'Invalid Request / unable to authenticate.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
        expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    it('fails safely on Cloudflare challenge edit responses without retrying', async () => {
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({
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
            reason: 'FFN returned editor content that did not match the imported HTML.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(2);
        expect(submitSpy).toHaveBeenCalledTimes(2);
    });

    it('cleans up the hidden form and iframe after response timeouts', async () => {
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
        fetchRequestTextMock.mockResolvedValueOnce(makeFetchResponse({ responseText: makeEditPage() }));
        const submitSpy = mockNativeSaveSubmission(() => {});

        const promise = DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');
        await vi.advanceTimersByTimeAsync(10);

        await expect(promise).resolves.toEqual({
            ok: false,
            reason: 'Request timed out.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(1);
        expect(submitSpy).toHaveBeenCalledTimes(1);
        expect(document.querySelector('iframe[name^="ffne_doc_save_"]')).toBeNull();
        expect(document.querySelector('form[target^="ffne_doc_save_"]')).toBeNull();
    });
});
