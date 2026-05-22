type AttrValue = string | boolean | number | null | undefined;
type Attrs = Record<string, AttrValue>;
type Child = Node | string | number | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Attrs | null,
    ...children: Array<Child | Child[]>
): HTMLElementTagNameMap[K];
export function h(
    tag: string,
    attrs?: Attrs | null,
    ...children: Array<Child | Child[]>
): HTMLElement;
export function h(
    tag: string,
    attrs?: Attrs | null,
    ...children: Array<Child | Child[]>
): HTMLElement {
    const el = document.createElement(tag);

    if (attrs) {
        Object.entries(attrs).forEach(([key, value]) => {
            if (value === false || value == null) return;
            if (value === true) {
                el.setAttribute(key, '');
                return;
            }
            el.setAttribute(key, String(value));
        });
    }

    children.flat().forEach(child => {
        if (child == null || child === false) return;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });

    return el;
}
