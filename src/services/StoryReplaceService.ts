import { SettingsManager } from '../modules/SettingsManager';
import { Elements } from '../enums/Elements';
import { StoryEditContentDelegate } from '../delegates/StoryEditContentDelegate';
import { Core } from '../modules/Core';

export interface StoryReplaceResult {
    ok: boolean;
    reason?: string;
}

type ReplacePhase = 'loading-page' | 'submitting-replace';

function appendHiddenInput(form: HTMLFormElement, name: string, value: string): HTMLInputElement {
    const input = form.ownerDocument.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
    return input;
}

function setControlValue(control: Element | null, value: string): boolean {
    if (control && 'value' in control) {
        const valueControl = control as HTMLInputElement | HTMLSelectElement | RadioNodeList;
        valueControl.value = value;
        return valueControl.value === value;
    }

    return false;
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function getExplicitFailureReason(doc: Document): string | null {
    const failure = StoryEditContentDelegate.getElement(Elements.STORY_EDIT_ERROR_PANEL, doc);
    const failureText = normalizeText(failure?.textContent || '');
    if (failureText) return failureText;

    const bodyText = normalizeText(doc.body?.textContent || '');
    if (/please\s+log\s*in|login\s+required|not\s+authorized/i.test(bodyText)) {
        return 'FFN returned a login or authorization page.';
    }

    return null;
}

export const StoryReplaceService = {
    submitReplaceForm: async function (actionUrl: string, storyTextId: string, docId: string): Promise<StoryReplaceResult> {
        const log = Core.getLogger('StoryReplaceService', 'submitReplaceForm');
        if (!storyTextId || !docId) {
            log('Replace submission blocked by missing chapter or source doc.', { storyTextId, docId });
            return { ok: false, reason: 'Missing chapter or source document selection.' };
        }

        return new Promise<StoryReplaceResult>((resolve) => {
            log(`Loading hidden StoryEditContent page for chapter ${storyTextId} and doc ${docId}.`, actionUrl);
            const iframe = document.createElement('iframe');
            iframe.name = `ffne_story_replace_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            iframe.style.position = 'absolute';
            iframe.style.width = '1px';
            iframe.style.height = '1px';
            iframe.style.left = '-9999px';
            iframe.style.top = '-9999px';
            iframe.style.border = 'none';
            iframe.style.visibility = 'hidden';

            let settled = false;
            let phase: ReplacePhase = 'loading-page';
            let timeoutId: number | null = null;

            const cleanup = () => {
                if (timeoutId !== null) window.clearTimeout(timeoutId);
                iframe.removeEventListener('load', onLoad);
                iframe.remove();
            };

            const resolveOnce = (result: StoryReplaceResult) => {
                if (settled) return;
                settled = true;
                log(`Hidden replace flow resolved: ${result.ok ? 'success' : 'failure'}.`, result.reason);
                cleanup();
                resolve(result);
            };

            const armTimeout = (ms: number, reason: string) => {
                if (timeoutId !== null) window.clearTimeout(timeoutId);
                timeoutId = window.setTimeout(() => {
                    log('Hidden replace flow timed out.', reason);
                    resolveOnce({ ok: false, reason });
                }, ms);
            };

            const submitNativeReplaceForm = (doc: Document): StoryReplaceResult | null => {
                const form = StoryEditContentDelegate.getElement(Elements.STORY_EDIT_REPLACE_FORM, doc) as HTMLFormElement | null;
                if (!form) {
                    log('Native replace form missing from hidden StoryEditContent page.');
                    return { ok: false, reason: 'Hidden StoryEditContent page did not contain the native replace form.' };
                }

                const chapterSelect = StoryEditContentDelegate.getElement(Elements.STORY_EDIT_CHAPTER_SELECT, doc);
                const docSelect = StoryEditContentDelegate.getElement(Elements.STORY_EDIT_DOC_SELECT, doc);
                const actionControl = StoryEditContentDelegate.getElement(Elements.STORY_EDIT_REPLACE_ACTION_CONTROL, doc);
                const didSetChapter = setControlValue(chapterSelect, storyTextId);
                const didSetDoc = setControlValue(docSelect, docId);
                if (!setControlValue(actionControl, 'replace')) {
                    appendHiddenInput(form, 'action', 'replace');
                }

                if (!didSetChapter) {
                    log('Hidden replace form did not accept selected chapter.', storyTextId);
                    return { ok: false, reason: 'Hidden replace form did not include the selected chapter.' };
                }
                if (!didSetDoc) {
                    log('Hidden replace form did not accept selected source doc.', docId);
                    return { ok: false, reason: 'Hidden replace form did not include the selected source document.' };
                }

                phase = 'submitting-replace';
                armTimeout(
                    SettingsManager.get('iframeSaveTimeoutMs'),
                    `No replace response returned within ${SettingsManager.get('iframeSaveTimeoutMs')}ms.`,
                );

                log('Submitting native replace form inside hidden StoryEditContent page.');
                form.submit();
                return null;
            };

            const onLoad = () => {
                try {
                    const doc = iframe.contentDocument;
                    if (!doc) {
                        log('Hidden StoryEditContent iframe had no readable document.');
                        resolveOnce({ ok: false, reason: 'Hidden StoryEditContent frame was not readable.' });
                        return;
                    }

                    const frameHref = iframe.contentWindow?.location.href || '';
                    if (phase === 'loading-page') {
                        if (!frameHref || frameHref === 'about:blank') return;

                        log('Hidden StoryEditContent page loaded; preparing native replace form.', frameHref);
                        const submitFailure = submitNativeReplaceForm(doc);
                        if (submitFailure) resolveOnce(submitFailure);
                        return;
                    }

                    if (phase === 'submitting-replace') {
                        const failureReason = getExplicitFailureReason(doc);
                        if (failureReason) {
                            log('Hidden replace response contained an explicit failure.', failureReason);
                            resolveOnce({ ok: false, reason: failureReason });
                            return;
                        }

                        log('Hidden replace response loaded without explicit failure.');
                        resolveOnce({ ok: true });
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    log('Could not inspect hidden StoryEditContent frame.', message);
                    resolveOnce({ ok: false, reason: `Could not inspect hidden StoryEditContent frame: ${message}` });
                }
            };

            iframe.addEventListener('load', onLoad);
            document.body.appendChild(iframe);

            try {
                armTimeout(
                    SettingsManager.get('iframeLoadTimeoutMs'),
                    `Hidden StoryEditContent page did not load within ${SettingsManager.get('iframeLoadTimeoutMs')}ms.`,
                );
                iframe.src = new URL(actionUrl, window.location.href).href;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log('Could not load hidden StoryEditContent page.', message);
                resolveOnce({ ok: false, reason: `Could not load hidden StoryEditContent page: ${message}` });
            }
        });
    },
};
