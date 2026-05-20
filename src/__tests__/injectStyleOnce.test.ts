import { beforeEach, describe, expect, it } from 'vitest';
import { injectStyleOnce } from '../utils/injectStyleOnce';

describe('injectStyleOnce', () => {
    beforeEach(() => {
        document.documentElement.innerHTML = '<head></head><body></body>';
    });

    it('inserts a style before the first matching anchor id', () => {
        injectStyleOnce('later-style', '.later {}');
        injectStyleOnce('early-style', '.early {}', document, ['later-style']);

        expect(Array.from(document.head.querySelectorAll('style')).map(style => style.id)).toEqual([
            'early-style',
            'later-style',
        ]);
    });

    it('moves an early document-start style into head once head exists', () => {
        document.head.remove();

        const style = injectStyleOnce('document-start-style', '.early {}');
        expect(style.parentNode).toBe(document.documentElement);

        const head = document.createElement('head');
        document.documentElement.insertBefore(head, document.body);

        injectStyleOnce('document-start-style', '.updated {}');

        expect(style.parentNode).toBe(document.head);
        expect(style.textContent).toBe('.updated {}');
    });
});
