import { describe, expect, it } from 'vitest';
import { DocFetchService } from '../services/DocFetchService';

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
