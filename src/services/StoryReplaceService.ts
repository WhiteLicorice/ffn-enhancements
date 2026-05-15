import { SettingsManager } from '../modules/SettingsManager';
import { Elements } from '../enums/Elements';
import { StoryEditContentDelegate } from '../delegates/StoryEditContentDelegate';
import { Core } from '../modules/Core';

export interface StoryReplaceResult {
    ok: boolean;
    reason?: string;
}

function appendHiddenInput(form: HTMLFormElement, name: string, value: string): HTMLInputElement {
    const input = form.ownerDocument.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
    return input;
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
            log(`Posting isolated replace form for chapter ${storyTextId} and doc ${docId}.`, actionUrl);
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
            let timeoutId: number | null = null;
            const form = document.createElement('form');

            const cleanup = () => {
                if (timeoutId !== null) window.clearTimeout(timeoutId);
                iframe.removeEventListener('load', onLoad);
                form.remove();
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

            const onLoad = () => {
                try {
                    const doc = iframe.contentDocument;
                    if (!doc) {
                        log('Hidden replace iframe had no readable document.');
                        resolveOnce({ ok: false, reason: 'Hidden replace response frame was not readable.' });
                        return;
                    }

                    const frameHref = iframe.contentWindow?.location.href || '';
                    const responseText = normalizeText(doc.body?.textContent || '');
                    if ((!frameHref || frameHref === 'about:blank') && !responseText) return;

                    const failureReason = getExplicitFailureReason(doc);
                    if (failureReason) {
                        log('Hidden replace response contained an explicit failure.', failureReason);
                        resolveOnce({ ok: false, reason: failureReason });
                        return;
                    }

                    log('Hidden replace response loaded without explicit failure.');
                    resolveOnce({ ok: true });
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    log('Could not inspect hidden replace response frame.', message);
                    resolveOnce({ ok: false, reason: `Could not inspect hidden replace response frame: ${message}` });
                }
            };

            iframe.addEventListener('load', onLoad);

            try {
                form.method = 'post';
                form.action = new URL(actionUrl, window.location.href).href;
                form.target = iframe.name;
                form.style.display = 'none';
                appendHiddenInput(form, 'storytextid', storyTextId);
                appendHiddenInput(form, 'docid', docId);
                appendHiddenInput(form, 'action', 'replace');

                document.body.append(iframe, form);
                armTimeout(
                    SettingsManager.get('iframeSaveTimeoutMs'),
                    `No replace response returned within ${SettingsManager.get('iframeSaveTimeoutMs')}ms.`,
                );
                log('Submitting isolated replace form to hidden iframe target.', {
                    action: form.action,
                    target: form.target,
                });
                form.submit();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log('Could not submit hidden replace form.', message);
                resolveOnce({ ok: false, reason: `Could not submit hidden replace form: ${message}` });
            }
        });
    },
};
