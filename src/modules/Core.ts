import TurndownService from 'turndown';

export const Core = {
    turndownService: new TurndownService({
        'hr': '---',
        'bulletListMarker': '-',
    }),

    log: function (page_name: string, funcName: string, msg: string, data?: any) {
        const prefix = `(ffn-enhancements) ${page_name} ${funcName}:`;
        if (data !== undefined) console.log(`${prefix} ${msg}`, data);
        else console.log(`${prefix} ${msg}`);
    },

    /**
     * Runs a callback when the DOM is fully loaded.
     */
    onDomReady: function (callback: () => void) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else {
            callback();
        }
    },

    /**
     * Extracts text from a DOM object and converts to Markdown.
     */
    parseContentFromDOM: function (doc: Document, title: string) {
        const func = 'Core.parseContent';
        const contentElement = (doc.querySelector("textarea[name='bio']") || 
                               doc.querySelector("#story_text") || 
                               doc.querySelector("#content")) as HTMLTextAreaElement | HTMLElement;

        if (!contentElement) {
            this.log('init', func, `Selectors failed for "${title}"`);
            return null;
        }

        const rawValue = (contentElement as HTMLTextAreaElement).value || contentElement.innerHTML;
        return this.turndownService.turndown(rawValue);
    },

    /**
     * Fetches a specific DocID and returns the Markdown content.
     */
    fetchAndConvertDoc: async function (docId: string, title: string) {
        const func = 'Core.fetchAndConvert';
        try {
            const response = await fetch(`https://www.fanfiction.net/docs/edit.php?docid=${docId}`);
            if (!response.ok) {
                this.log('init', func, `Network Error for ${docId}: ${response.status}`);
                return null;
            }

            const text = await response.text();
            const doc = new DOMParser().parseFromString(text, 'text/html');
            const markdown = this.parseContentFromDOM(doc, title);

            if (markdown) {
                this.log('init', func, `Content extracted for "${title}". Length: ${markdown.length}`);
                return markdown;
            }
        } catch (err) {
            this.log('init', func, `Error processing ${title}`, err);
        }
        return null;
    }
};