import { SettingsManager } from '../modules/SettingsManager';

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

function findReplaceForm(doc: Document): HTMLFormElement | null {
    const forms = Array.from(doc.forms);
    return forms.find(form => {
        const chapterSelect = form.querySelector('select[name="storytextid"]');
        const docSelect = form.querySelector('select[name="docid"]');
        const replaceAction = form.querySelector('input[name="action"][value="replace"], button[name="action"][value="replace"]');
        return !!chapterSelect && !!docSelect && !!replaceAction;
    }) || null;
}

function setFormValue(form: HTMLFormElement, name: string, value: string): boolean {
    const control = form.elements.namedItem(name);
    if (control && 'value' in control) {
        const valueControl = control as HTMLInputElement | HTMLSelectElement | RadioNodeList;
        valueControl.value = value;
        return valueControl.value === value;
    }

    appendHiddenInput(form, name, value);
    return true;
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function getExplicitFailureReason(doc: Document): string | null {
    const failure = doc.querySelector('.panel_error, .gui_error, .alert-error, .error');
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
        if (!storyTextId || !docId) {
            return { ok: false, reason: 'Missing chapter or source document selection.' };
        }

        return new Promise<StoryReplaceResult>((resolve) => {
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
                cleanup();
                resolve(result);
            };

            const armTimeout = (ms: number, reason: string) => {
                if (timeoutId !== null) window.clearTimeout(timeoutId);
                timeoutId = window.setTimeout(() => resolveOnce({ ok: false, reason }), ms);
            };

            const submitNativeReplaceForm = (doc: Document): StoryReplaceResult | null => {
                const form = findReplaceForm(doc);
                if (!form) {
                    return { ok: false, reason: 'Hidden StoryEditContent page did not contain the native replace form.' };
                }

                const didSetChapter = setFormValue(form, 'storytextid', storyTextId);
                const didSetDoc = setFormValue(form, 'docid', docId);
                setFormValue(form, 'action', 'replace');

                if (!didSetChapter) {
                    return { ok: false, reason: 'Hidden replace form did not include the selected chapter.' };
                }
                if (!didSetDoc) {
                    return { ok: false, reason: 'Hidden replace form did not include the selected source document.' };
                }

                phase = 'submitting-replace';
                armTimeout(
                    SettingsManager.get('iframeSaveTimeoutMs'),
                    `No replace response returned within ${SettingsManager.get('iframeSaveTimeoutMs')}ms.`,
                );

                form.submit();
                return null;
            };

            const onLoad = () => {
                try {
                    const doc = iframe.contentDocument;
                    if (!doc) {
                        resolveOnce({ ok: false, reason: 'Hidden StoryEditContent frame was not readable.' });
                        return;
                    }

                    const frameHref = iframe.contentWindow?.location.href || '';
                    if (phase === 'loading-page') {
                        if (!frameHref || frameHref === 'about:blank') return;

                        const submitFailure = submitNativeReplaceForm(doc);
                        if (submitFailure) resolveOnce(submitFailure);
                        return;
                    }

                    if (phase === 'submitting-replace') {
                        const failureReason = getExplicitFailureReason(doc);
                        if (failureReason) {
                            resolveOnce({ ok: false, reason: failureReason });
                            return;
                        }

                        resolveOnce({ ok: true });
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
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
                resolveOnce({ ok: false, reason: `Could not load hidden StoryEditContent page: ${message}` });
            }
        });
    },
};
