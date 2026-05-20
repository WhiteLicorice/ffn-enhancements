import { sanitizeEditorHtml } from './htmlSanitizer';

/**
 * Strips HTML tags using DOMParser. More robust than regex for edge cases.
 */
function stripHtmlBasic(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
}

/**
 * Legacy fallback for plain text: temp textarea + execCommand('copy').
 */
function copyTextFallback(text: string): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        document.body.removeChild(textarea);
    }
}

/**
 * Legacy fallback for HTML: hidden contentEditable div + execCommand('copy').
 * The browser natively writes both text/html and text/plain MIME types.
 */
function copyHtmlFallback(html: string): boolean {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.innerHTML = html;
    div.style.position = 'fixed';
    div.style.left = '-9999px';
    div.style.top = '-9999px';
    div.style.opacity = '0';
    document.body.appendChild(div);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(div);
    selection?.addRange(range);

    try {
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        selection?.removeAllRanges();
        document.body.removeChild(div);
    }
}

/**
 * Writes content to the system clipboard.
 *
 * Fallback chain (HTML):
 * 1. ClipboardItem API (modern browsers, writes both text/html + text/plain)
 * 2. contentEditable div + execCommand('copy') (legacy fallback)
 *
 * Fallback chain (plain text):
 * 1. navigator.clipboard.writeText()
 * 2. textarea + execCommand('copy')
 *
 * @returns true if clipboard write succeeded, false otherwise.
 */
export async function writeToClipboard(
    content: string,
    isHtml: boolean
): Promise<boolean> {
    if (isHtml) {
        const sanitizedHtml = sanitizeEditorHtml(content);
        // 1. ClipboardItem API — writes both text/html and text/plain.
        try {
            const plainText = stripHtmlBasic(sanitizedHtml);
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([sanitizedHtml], { type: 'text/html' }),
                    'text/plain': new Blob([plainText], { type: 'text/plain' }),
                }),
            ]);
            return true;
        } catch {
            // Fall through to execCommand.
        }

        // 3. contentEditable div + execCommand('copy').
        return copyHtmlFallback(sanitizedHtml);
    }

    try {
        await navigator.clipboard.writeText(content);
        return true;
    } catch {
        // writeText not available — fall through to execCommand.
    }

    return copyTextFallback(content);
}
