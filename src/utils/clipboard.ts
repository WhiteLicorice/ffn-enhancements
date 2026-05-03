/**
 * Strips HTML tags using DOMParser. More robust than regex for edge cases.
 */
function stripHtmlBasic(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
}

/**
 * Legacy fallback: temp textarea + execCommand('copy').
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
 * Preserves both text/html and text/plain on clipboard when ClipboardItem API fails.
 * Uses a hidden contentEditable div — selecting its content and calling
 * execCommand('copy') causes the browser to write both MIME types natively.
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
 * For HTML content: tries navigator.clipboard.write() with both text/html
 * and text/plain MIME types so pasting into rich editors preserves formatting
 * while plain-text contexts get readable text.
 *
 * Fallback chain:
 * 1. ClipboardItem API (HTML only) → 2. writeText() → 3. execCommand('copy')
 *
 * @returns true if clipboard write succeeded, false otherwise.
 */
export async function writeToClipboard(
    content: string,
    isHtml: boolean
): Promise<boolean> {
    if (isHtml) {
        try {
            const plainText = stripHtmlBasic(content);
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([content], { type: 'text/html' }),
                    'text/plain': new Blob([plainText], { type: 'text/plain' }),
                }),
            ]);
            return true;
        } catch {
            // ClipboardItem not available — fall through to HTML-specific
            // fallback that preserves both MIME types.
            return copyHtmlFallback(content);
        }
    }

    try {
        await navigator.clipboard.writeText(content);
        return true;
    } catch {
        // writeText not available — fall through to execCommand.
    }

    return copyTextFallback(content);
}
