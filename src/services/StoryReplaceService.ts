export interface StoryReplaceResult {
    ok: boolean;
    reason?: string;
}

export const StoryReplaceService = {
    submitReplaceForm: async function (actionUrl: string, storyTextId: string, docId: string): Promise<StoryReplaceResult> {
        const body = new URLSearchParams({
            storytextid: storyTextId,
            docid: docId,
            action: 'replace',
        });

        const response = await fetch(actionUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            body: body.toString(),
        });

        if (!response.ok) {
            return { ok: false, reason: `Replace request failed with HTTP ${response.status}.` };
        }

        await response.text();
        return { ok: true };
    },
};
