export const FFNE_UI_ATTR = 'data-ffne-ui';
export const FFNE_UI_EXCLUDE_SELECTOR = `[${FFNE_UI_ATTR}], [${FFNE_UI_ATTR}] *`;

export function markFfneUiRoot<T extends HTMLElement>(element: T): T {
    element.setAttribute(FFNE_UI_ATTR, '');
    return element;
}
