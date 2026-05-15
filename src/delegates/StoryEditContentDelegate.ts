import { Elements } from '../enums/Elements';
import { BaseDelegate } from './BaseDelegate';
import { IDelegate } from './IDelegate';
import { STORY_EDIT_CONTENT_CHAPTER_ID_ATTR } from '../interfaces/IStoryEditContent';

export const StoryEditContentDelegate: IDelegate = {
    ...BaseDelegate,

    getElement(key: Elements, doc: Document = document): HTMLElement | null {
        switch (key) {
            case Elements.STORY_EDIT_REPLACE_FORM:
                return findReplaceForm(doc);

            case Elements.STORY_EDIT_CHAPTER_SELECT:
                return findReplaceForm(doc)?.querySelector('select[name="storytextid"]') || null;

            case Elements.STORY_EDIT_DOC_SELECT:
                return findReplaceForm(doc)?.querySelector('select[name="docid"]') || null;

            case Elements.STORY_EDIT_REPLACE_ACTION_CONTROL:
                return findNamedReplaceActionControl(doc);

            case Elements.STORY_EDIT_REPLACE_SUBMIT: {
                const form = findReplaceForm(doc);
                return form ? findReplaceSubmitInForm(form) : null;
            }

            case Elements.STORY_EDIT_REPLACE_TOGGLE:
                return findReplaceUpdateToggle(doc);

            case Elements.STORY_EDIT_ERROR_PANEL:
                return doc.querySelector<HTMLElement>('.panel_error, .gui_error, .alert-error, .error');

            default:
                return null;
        }
    },

    getElements(key: Elements, doc: Document = document): HTMLElement[] {
        switch (key) {
            case Elements.STORY_EDIT_CHAPTER_ROWS:
                return findLikelyChapterRows(doc);

            default:
                return [];
        }
    },
};

function findReplaceForm(doc: Document = document): HTMLFormElement | null {
    const forms = Array.from(doc.forms);
    return forms.find(form => {
        const chapterSelect = form.querySelector('select[name="storytextid"]');
        const docSelect = form.querySelector('select[name="docid"]');
        const replaceAction = findNamedReplaceActionControlInForm(form);
        const replaceSubmit = findReplaceSubmitInForm(form);
        return !!chapterSelect && !!docSelect && (!!replaceAction || !!replaceSubmit);
    }) || null;
}

function findNamedReplaceActionControl(doc: Document = document): HTMLElement | null {
    const form = findReplaceForm(doc);
    return form ? findNamedReplaceActionControlInForm(form) : null;
}

function findNamedReplaceActionControlInForm(form: HTMLFormElement): HTMLElement | null {
    return form.querySelector<HTMLElement>(
        'input[name="action"][value="replace"], button[name="action"][value="replace"]'
    );
}

function findReplaceSubmitInForm(form: HTMLFormElement): HTMLElement | null {
    return form.querySelector<HTMLElement>(
        'button[type="submit"], input[type="submit"][value*="Replace"], button[type="submit"][value="replace"]'
    );
}

function findReplaceUpdateToggle(doc: Document = document): HTMLAnchorElement | null {
    return Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href="#"], a'))
        .find(anchor => /replace\s*\/\s*update\s+chapter/i.test(normalizeText(anchor.textContent || ''))) || null;
}

function findLikelyChapterRows(doc: Document = document): HTMLElement[] {
    const explicitRows = Array.from(doc.querySelectorAll<HTMLElement>(
        'tr[data-storytextid], tr[data-story-text-id], tr[data-storytext-id], table tbody tr'
    ));

    return explicitRows.filter(row => {
        const text = normalizeText(row.textContent || '');
        const storyTextId = extractStoryTextId(row);
        if (storyTextId) {
            row.setAttribute(STORY_EDIT_CONTENT_CHAPTER_ID_ATTR, storyTextId);
        }
        return !!storyTextId || /published|draft|chapter/i.test(text);
    });
}

function extractStoryTextId(row: HTMLElement): string {
    const dataId = row.getAttribute('data-storytextid')
        || row.getAttribute('data-story-text-id')
        || row.getAttribute('data-storytext-id');
    if (dataId) return dataId;

    const candidates = Array.from(row.querySelectorAll<HTMLElement>('a[href], input[value], button[value], select option[value]'));
    for (const candidate of candidates) {
        const value = candidate instanceof HTMLAnchorElement ? candidate.href : candidate.getAttribute('value') || '';
        const match = value.match(/storytextid=(\d+)/i) || value.match(/^(\d+)$/);
        if (match) return match[1];
    }

    return '';
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}
