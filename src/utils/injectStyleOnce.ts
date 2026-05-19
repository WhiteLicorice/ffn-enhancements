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
        const anchor = beforeIds
            .map(beforeId => rootDocument.getElementById(beforeId))
            .find((element): element is HTMLElement => !!element);
        const target = (anchor?.parentNode as HTMLElement | null)
            || rootDocument.head
            || rootDocument.documentElement;
        if (anchor && anchor.parentNode === target) {
            target.insertBefore(style, anchor);
        } else {
            target.appendChild(style);
        }
    }

    style.textContent = css;
    return style;
}
