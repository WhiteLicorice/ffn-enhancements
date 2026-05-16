import { Elements } from '../enums/Elements';
import { BaseDelegate } from './BaseDelegate';
import { IDelegate } from './IDelegate';

export const Ao3Delegate: IDelegate = {
    ...BaseDelegate,

    getElement(key: Elements, doc: Document = document): HTMLElement | null {
        switch (key) {
            case Elements.AO3_LOGIN_INDICATOR:
                if (doc.body?.classList.contains('logged-in')) return doc.body;
                return doc.querySelector('#header .user.navigation.actions, #header ul.user.navigation.actions') as HTMLElement | null;

            case Elements.AO3_CHAPTER_EDIT_FORM:
                return doc.querySelector('form.edit_chapter, form[action*="/chapters/"]') as HTMLElement | null;

            case Elements.AO3_CHAPTER_CONTENT_TEXTAREA:
                return doc.querySelector('textarea#content[name="chapter[content]"]') as HTMLElement | null;

            case Elements.AO3_CHAPTER_UPDATE_BUTTON:
                return doc.querySelector('input[name="update_button"], button[name="update_button"]') as HTMLElement | null;

            default:
                return null;
        }
    },

    getElements(key: Elements, doc: Document = document): HTMLElement[] {
        switch (key) {
            case Elements.AO3_WORK_CHAPTER_LINKS:
                return Array.from(doc.querySelectorAll('ol.chapter.index.group li a[href*="/chapters/"]')) as HTMLElement[];

            default:
                return [];
        }
    },
};
