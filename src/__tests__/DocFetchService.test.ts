import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    action?: string;
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

    return `
        <form name="docform" action="${action}">
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
        const params = new URLSearchParams(result.body);
        expect(params.get('bio')).toBe('<p>Imported</p>');
        expect(params.get('action')).toBe('save');
        expect(params.get('docid')).toBe('123');
        expect(params.get('selectdocid')).toBe('123');
        expect(params.get('csrf')).toBe('token-123');
        expect(params.get('keep')).toBe('yes');
        expect(params.get('mode')).toBe('html');
        expect(params.has('skip')).toBe(false);
    });

    it('posts through the service-worker fetch helper and never creates an iframe', async () => {
        fetchRequestTextMock
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: makeEditPage(),
            }))
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: '<div class="panel_success">Document successfully saved.</div>',
            }));
        const createElementSpy = vi.spyOn(document, 'createElement');

        const result = await DocFetchService.refreshPrivateDoc('123', 'Doc Name');

        expect(result).toBe(true);
        expect(fetchRequestTextMock).toHaveBeenNthCalledWith(1, {
            method: 'GET',
            url: 'https://www.fanfiction.net/docs/edit.php?docid=123',
        });
        expect(fetchRequestTextMock).toHaveBeenNthCalledWith(2, {
            method: 'POST',
            url: 'https://www.fanfiction.net/docs/edit.php?docid=123',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            data: expect.any(String),
            timeout: 4321,
        });
        expect(createElementSpy.mock.calls.some(([tag]) => tag === 'iframe')).toBe(false);
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
        fetchRequestTextMock
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: makeEditPage(),
            }))
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: '<div class="panel_success">Success! Document successfully saved.</div>',
            }));

        await expect(DocFetchService.refreshPrivateDoc('123', 'Doc Name')).resolves.toBe(true);
    });

    it('accepts a clean refresh response with the same docid and non-empty textarea', async () => {
        fetchRequestTextMock
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: makeEditPage({ textareaValue: 'Existing content' }),
            }))
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: makeEditPage({ textareaValue: 'Existing content' }),
            }));

        await expect(DocFetchService.refreshPrivateDoc('123', 'Doc Name')).resolves.toBe(true);
    });

    it('accepts an import response when the returned textarea matches the submitted HTML after normalization', async () => {
        fetchRequestTextMock
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: makeEditPage(),
            }))
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: makeEditPage({ textareaValue: '<p>Imported</p>\r\n<div>Body</div>' }),
            }));

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>\n<div>Body</div>');

        expect(result).toEqual({ ok: true, retryable: false });
    });

    it('fails safely on explicit auth or authorization responses without retrying', async () => {
        fetchRequestTextMock
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: makeEditPage(),
            }))
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: '<div class="panel_error">No permission.</div>',
            }));

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'No permission.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(2);
    });

    it('fails safely on Cloudflare challenge responses without retrying', async () => {
        fetchRequestTextMock
            .mockResolvedValueOnce(makeFetchResponse({
                responseText: makeEditPage(),
            }))
            .mockResolvedValueOnce(makeFetchResponse({
                ok: false,
                status: 403,
                responseText: 'DDoS protection by Cloudflare',
                isCfChallenge: true,
            }));

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result.ok).toBe(false);
        expect(result.reason).toContain('Cloudflare');
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(2);
    });

    it('retries import mismatch failures and returns the mismatch reason after retry exhaustion', async () => {
        fetchRequestTextMock
            .mockResolvedValueOnce(makeFetchResponse({ responseText: makeEditPage() }))
            .mockResolvedValueOnce(makeFetchResponse({ responseText: makeEditPage({ textareaValue: '<p>Wrong</p>' }) }))
            .mockResolvedValueOnce(makeFetchResponse({ responseText: makeEditPage() }))
            .mockResolvedValueOnce(makeFetchResponse({ responseText: makeEditPage({ textareaValue: '<p>Wrong</p>' }) }));

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'FFN returned editor content that did not match the imported HTML.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(4);
    });

    it('retries timeout failures and returns the timeout reason after retry exhaustion', async () => {
        fetchRequestTextMock
            .mockResolvedValueOnce(makeFetchResponse({ responseText: makeEditPage() }))
            .mockResolvedValueOnce(makeFetchResponse({
                ok: false,
                status: 0,
                reason: 'Request timed out.',
            }))
            .mockResolvedValueOnce(makeFetchResponse({ responseText: makeEditPage() }))
            .mockResolvedValueOnce(makeFetchResponse({
                ok: false,
                status: 0,
                reason: 'Request timed out.',
            }));

        const result = await DocFetchService.replacePrivateDocContentWithResult('123', 'Doc Name', '<p>Imported</p>');

        expect(result).toEqual({
            ok: false,
            reason: 'Request timed out.',
        });
        expect(fetchRequestTextMock).toHaveBeenCalledTimes(4);
    });
});
