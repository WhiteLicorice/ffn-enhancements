import { Ao3Delegate } from '../delegates/Ao3Delegate';
import { Elements } from '../enums/Elements';
import { IAo3Chapter } from '../interfaces/IAo3Migration';
import { Core } from '../modules/Core';
import { gmRequestText } from '../utils/gmRequestText';

interface Ao3ChapterIndexResult {
    ok: boolean;
    chapters: IAo3Chapter[];
    reason?: string;
}

interface Ao3UpdateResult {
    ok: boolean;
    reason?: string;
}

interface Ao3UpdatePayloadResult {
    ok: boolean;
    actionUrl?: string;
    body?: string;
    reason?: string;
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeUrlForComparison(value: string | undefined): string {
    if (!value) return '';
    try {
        const parsed = new URL(value, 'https://archiveofourown.org');
        parsed.hash = '';
        parsed.search = '';
        return parsed.href.replace(/\/+$/, '');
    } catch {
        return value.replace(/[?#].*$/, '').replace(/\/+$/, '');
    }
}

function appendControl(params: URLSearchParams, control: Element): void {
    if (!(control instanceof HTMLElement)) return;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement || control instanceof HTMLButtonElement)) {
        return;
    }

    const name = control.name?.trim();
    if (!name || control.disabled) return;

    if (control instanceof HTMLInputElement) {
        const type = control.type.toLowerCase();
        if (type === 'file' || type === 'reset' || type === 'button' || type === 'submit' || type === 'image') return;
        if ((type === 'checkbox' || type === 'radio') && !control.checked) return;
        params.append(name, control.value);
        return;
    }

    if (control instanceof HTMLTextAreaElement) {
        params.append(name, control.value);
        return;
    }

    if (control instanceof HTMLSelectElement) {
        if (control.multiple) {
            Array.from(control.selectedOptions).forEach(option => params.append(name, option.value));
            return;
        }
        params.append(name, control.value);
        return;
    }

}

export const Ao3Service = {
    MODULE_NAME: 'Ao3Service',

    normalizeWorkUrl(input: string): string | null {
        const trimmed = input.trim();
        if (!trimmed) return null;

        let parsed: URL;
        try {
            parsed = new URL(trimmed);
        } catch {
            return null;
        }

        if (parsed.hostname !== 'archiveofourown.org') return null;

        const match = parsed.pathname.match(/\/works\/(\d+)/);
        if (!match) return null;

        return `https://archiveofourown.org/works/${match[1]}`;
    },

    async fetchChapterIndex(workUrl: string): Promise<Ao3ChapterIndexResult> {
        const log = Core.getLogger(this.MODULE_NAME, 'fetchChapterIndex');
        const normalized = this.normalizeWorkUrl(workUrl);
        if (!normalized) {
            log('AO3 chapter index fetch blocked by invalid work URL.', { input: workUrl });
            return { ok: false, chapters: [], reason: 'Enter a valid AO3 work URL.' };
        }

        log('Fetching AO3 chapter index.', { workUrl: normalized });
        const response = await gmRequestText({
            method: 'GET',
            url: `${normalized}/navigate`,
        });
        if (!response.ok) {
            log('AO3 chapter index request failed.', {
                workUrl: normalized,
                status: response.status,
                reason: response.reason,
            });
            return {
                ok: false,
                chapters: [],
                reason: response.reason || `AO3 chapter index request failed with HTTP ${response.status}.`,
            };
        }

        const doc = new DOMParser().parseFromString(response.responseText, 'text/html');
        if (!this._isLoggedInDocument(doc)) {
            log('AO3 chapter index response did not look logged in.', { workUrl: normalized });
            return { ok: false, chapters: [], reason: 'AO3 login required. Open AO3 in this browser and sign in first.' };
        }

        const chapters = this._parseChapterIndex(doc, normalized);
        if (chapters.length === 0) {
            log('AO3 chapter index response contained no parseable chapter links.', { workUrl: normalized });
            return { ok: false, chapters: [], reason: 'Could not find any AO3 chapters on the navigate page.' };
        }

        log('AO3 chapter index parsed.', {
            workUrl: normalized,
            chapterCount: chapters.length,
        });
        return { ok: true, chapters };
    },

    async updateChapterContent(chapter: IAo3Chapter, html: string): Promise<Ao3UpdateResult> {
        const log = Core.getLogger(this.MODULE_NAME, 'updateChapterContent');
        if (!html.trim()) {
            log('AO3 chapter update blocked by empty replacement HTML.', {
                chapterId: chapter.chapterId,
                editUrl: chapter.editUrl,
            });
            return { ok: false, reason: 'Replacement chapter content is empty.' };
        }

        log('Fetching AO3 chapter edit page.', {
            chapterId: chapter.chapterId,
            editUrl: chapter.editUrl,
            replacementLength: html.length,
        });
        const editResponse = await gmRequestText({
            method: 'GET',
            url: chapter.editUrl,
        });
        if (!editResponse.ok) {
            log('AO3 chapter edit page request failed.', {
                chapterId: chapter.chapterId,
                status: editResponse.status,
                reason: editResponse.reason,
            });
            return {
                ok: false,
                reason: editResponse.reason || `AO3 edit page request failed with HTTP ${editResponse.status}.`,
            };
        }

        const editDoc = new DOMParser().parseFromString(editResponse.responseText, 'text/html');
        if (!this._isLoggedInDocument(editDoc)) {
            log('AO3 chapter edit page response did not look logged in.', { chapterId: chapter.chapterId });
            return { ok: false, reason: 'AO3 login expired before the chapter edit page loaded.' };
        }

        const payload = this._buildUpdatePayload(editDoc, chapter, html);
        if (!payload.ok || !payload.actionUrl || payload.body === undefined) {
            log('AO3 chapter update payload could not be built.', {
                chapterId: chapter.chapterId,
                reason: payload.reason,
            });
            return { ok: false, reason: payload.reason || 'Could not build the AO3 chapter update payload.' };
        }

        log('Posting AO3 chapter update payload.', {
            chapterId: chapter.chapterId,
            actionUrl: payload.actionUrl,
            payloadLength: payload.body.length,
        });
        const updateResponse = await gmRequestText({
            method: 'POST',
            url: payload.actionUrl,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            data: payload.body,
        });
        if (!updateResponse.ok) {
            log('AO3 chapter update POST failed.', {
                chapterId: chapter.chapterId,
                status: updateResponse.status,
                reason: updateResponse.reason,
            });
            return {
                ok: false,
                reason: updateResponse.reason || `AO3 chapter update failed with HTTP ${updateResponse.status}.`,
            };
        }

        const resultDoc = new DOMParser().parseFromString(updateResponse.responseText, 'text/html');
        if (!this._isLoggedInDocument(resultDoc)) {
            log('AO3 chapter update response did not look logged in.', { chapterId: chapter.chapterId });
            return { ok: false, reason: 'AO3 login expired before the update finished.' };
        }

        const result = this._detectUpdateResult(resultDoc, chapter, updateResponse.finalUrl);
        if (!result.ok) {
            log('AO3 chapter update failed validation.', {
                chapterId: chapter.chapterId,
                reason: result.reason,
            });
        } else {
            log('AO3 chapter update response validated.', {
                chapterId: chapter.chapterId,
                finalUrl: updateResponse.finalUrl,
            });
        }
        return result;
    },

    _isLoggedInDocument(doc: Document): boolean {
        return !!Ao3Delegate.getElement(Elements.AO3_LOGIN_INDICATOR, doc);
    },

    _parseChapterIndex(doc: Document, workUrl: string): IAo3Chapter[] {
        const workId = workUrl.match(/\/works\/(\d+)/)?.[1] || '';
        return Ao3Delegate.getElements(Elements.AO3_WORK_CHAPTER_LINKS, doc)
            .map((link, index) => {
                const anchor = link as HTMLAnchorElement;
                const href = anchor.getAttribute('href') || '';
                const chapterId = href.match(/\/chapters\/(\d+)/)?.[1] || '';
                if (!workId || !chapterId) return null;

                const title = normalizeText(anchor.textContent || `Chapter ${index + 1}`);
                return {
                    workId,
                    chapterId,
                    chapterNumber: index + 1,
                    label: `Chapter ${index + 1}: ${title}`,
                    title,
                    readerUrl: `https://archiveofourown.org/works/${workId}/chapters/${chapterId}`,
                    editUrl: `https://archiveofourown.org/works/${workId}/chapters/${chapterId}/edit`,
                } satisfies IAo3Chapter;
            })
            .filter((chapter): chapter is IAo3Chapter => !!chapter);
    },

    _buildUpdatePayload(doc: Document, chapter: IAo3Chapter, html: string): Ao3UpdatePayloadResult {
        const textarea = Ao3Delegate.getElement(Elements.AO3_CHAPTER_CONTENT_TEXTAREA, doc) as HTMLTextAreaElement | null;
        const updateButton = Ao3Delegate.getElement(Elements.AO3_CHAPTER_UPDATE_BUTTON, doc) as HTMLInputElement | HTMLButtonElement | null;
        const form = (textarea?.closest('form') || Ao3Delegate.getElement(Elements.AO3_CHAPTER_EDIT_FORM, doc)) as HTMLFormElement | null;

        if (!textarea || !form) {
            return { ok: false, reason: 'Could not find the AO3 chapter edit form.' };
        }

        const params = new URLSearchParams();
        Array.from(form.elements).forEach(element => appendControl(params, element));
        params.set(textarea.name, html);
        params.set('update_button', updateButton?.value || 'Update');

        const actionUrl = new URL(form.getAttribute('action') || chapter.editUrl, chapter.editUrl).href;
        return {
            ok: true,
            actionUrl,
            body: params.toString(),
        };
    },

    _detectUpdateResult(doc: Document, chapter: IAo3Chapter, finalUrl?: string): Ao3UpdateResult {
        const failure = this._getExplicitFailureReason(doc);
        if (failure) return { ok: false, reason: failure };

        if (Ao3Delegate.getElement(Elements.AO3_CHAPTER_CONTENT_TEXTAREA, doc)) {
            return { ok: false, reason: 'AO3 returned the chapter edit form instead of the updated chapter page.' };
        }

        const finalUrlPath = normalizeUrlForComparison(finalUrl);
        const readerUrl = normalizeUrlForComparison(chapter.readerUrl);
        if (finalUrlPath && readerUrl && finalUrlPath === readerUrl) {
            return { ok: true };
        }

        if (doc.querySelector(`#chapter-${chapter.chapterId} .userstuff, #chapter_${chapter.chapterId} .userstuff, .chapter .userstuff, #chapters .userstuff`)) {
            return { ok: true };
        }

        return { ok: false, reason: 'AO3 did not return the updated reader-facing chapter page.' };
    },

    _getExplicitFailureReason(doc: Document): string | null {
        const selectors = [
            '.flash.error',
            '.error',
            '.notice.error',
            '#main .error',
        ];

        for (const selector of selectors) {
            const text = normalizeText(doc.querySelector(selector)?.textContent || '');
            if (text) return text;
        }

        const bodyText = normalizeText(doc.body?.textContent || '');
        if (/please\s+log\s*in|log\s*in\s+or\s+sign\s+up/i.test(bodyText)) {
            return 'AO3 login required.';
        }

        return null;
    },
};
