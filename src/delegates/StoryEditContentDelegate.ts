import { Elements } from '../enums/Elements';
import { BaseDelegate } from './BaseDelegate';
import { IDelegate } from './IDelegate';

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
        const replaceAction = form.querySelector(
            'input[name="action"][value="replace"], button[name="action"][value="replace"], input[type="submit"][value*="Replace"], button[type="submit"][value="replace"]'
        );
        return !!chapterSelect && !!docSelect && !!replaceAction;
    }) || null;
}

function findLikelyChapterRows(doc: Document = document): HTMLElement[] {
    const explicitRows = Array.from(doc.querySelectorAll<HTMLElement>(
        'tr[data-storytextid], tr[data-story-text-id], tr[data-storytext-id], table tbody tr'
    ));

    return explicitRows.filter(row => {
        const text = normalizeText(row.textContent || '');
        return !!extractStoryTextId(row) || /published|draft|chapter/i.test(text);
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
