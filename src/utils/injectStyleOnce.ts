export function injectStyleOnce(
    id: string,
    css: string,
    rootDocument: Document = document,
    beforeIds: string[] = [],
): HTMLStyleElement {
    let style = rootDocument.getElementById(id) as HTMLStyleElement | null;
    if (!style) {
        style = rootDocument.createElement('style');
        style.id = id;
    }

    placeStyle(style, rootDocument, beforeIds);
    style.textContent = css;
    return style;
}

function placeStyle(style: HTMLStyleElement, rootDocument: Document, beforeIds: string[]): void {
    const target = rootDocument.head || rootDocument.documentElement;
    const anchor = beforeIds
        .map(beforeId => rootDocument.getElementById(beforeId))
        .find((element): element is HTMLElement => !!element && element.parentNode === target);

    if (anchor) {
        if (style.nextSibling !== anchor || style.parentNode !== target) {
            target.insertBefore(style, anchor);
        }
        return;
    }

    if (style.parentNode !== target) {
        target.appendChild(style);
    }
}
