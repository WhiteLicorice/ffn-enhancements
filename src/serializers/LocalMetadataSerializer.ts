// serializers/LocalMetadataSerializer.ts

import { Core } from '../modules/Core';
import { Elements } from '../enums/Elements';
import { IMetadataSerializer } from '../interfaces/IMetadataSerializer';
import { StoryMetadata } from '../interfaces/StoryMetadata';

/**
 * Serializer responsible for scraping metadata directly from the current FanFiction.net DOM.
 */
export class LocalMetadataSerializer implements IMetadataSerializer {
    private _storyId: string;
    private _storyUrl: string;
    private _metaBlock: Element | null;
    private _chapSelect: HTMLSelectElement | null;
    private _parsedMeta: Partial<StoryMetadata> | null = null;

    constructor(storyId: string, storyUrl: string) {
        this._storyId = storyId;
        this._storyUrl = storyUrl;
        this._metaBlock = Core.getElement(Elements.STORY_META_BLOCK);
        this._chapSelect = Core.getElement(Elements.CHAPTER_DROPDOWN) as HTMLSelectElement;
    }

    /**
     * Returns the chapter count based on the dropdown menu or defaults to 1.
     */
    public getChapterCount(): number {
        return this._chapSelect ? this._chapSelect.options.length : 1;
    }

    /**
     * Returns the Updated date (or Published date if never updated) from the DOM.
     */
    public getUpdatedDate(): Date {
        if (!this._metaBlock) return new Date(0);

        const timeNodes = this._metaBlock.querySelectorAll('[data-xutime]');
        if (timeNodes.length === 0) return new Date(0);

        // The first data-xutime is usually 'Updated', or 'Published' if never updated.
        const unix = parseInt(timeNodes[0].getAttribute('data-xutime') || '0', 10);
        return new Date(unix * 1000);
    }

    /**
     * Serializes the DOM elements into a full StoryMetadata object.
     */
    public async serialize(): Promise<StoryMetadata> {
        const title = Core.getElement(Elements.STORY_TITLE)?.textContent || 'Unknown Title';
        const authorEl = Core.getElement(Elements.STORY_AUTHOR) as HTMLAnchorElement;
        const author = authorEl?.textContent || 'Unknown Author';
        const authorUrl = authorEl?.href;
        const summary = Core.getElement(Elements.STORY_SUMMARY)?.textContent || '';

        // Lazy load parsed text metadata
        if (!this._parsedMeta) {
            this._parsedMeta = this._parseFFNMetadata(this._metaBlock?.textContent || '');
        }

        // Fix Dates using data-xutime for accuracy
        this._enrichDatesWithUnix(this._parsedMeta);

        // Fetch Cover Art
        const coverBlob = await this._fetchCoverArt();

        return {
            id: this._storyId,
            title,
            author,
            authorUrl,
            description: summary,
            source: 'FanFiction.net',
            storyUrl: this._storyUrl,
            coverBlob: coverBlob,
            ...this._parsedMeta
        };
    }

    /**
     * Internal helper to fetch cover art with resolution probing.
     */
    private async _fetchCoverArt(): Promise<Blob | undefined> {
        const log = Core.getLogger('LocalMetadataSerializer', 'fetchCoverArt');
        const coverImg = Core.getElement(Elements.STORY_COVER) as HTMLImageElement;

        if (!coverImg || !coverImg.src) return undefined;

        const baseUrl = coverImg.src;
        const resolutions = ['/180/', '/150/'];

        for (const res of resolutions) {
            try {
                const targetUrl = baseUrl.replace(/\/75\/|\/150\/|\/180\//, res);
                const imgResp = await fetch(targetUrl);
                if (imgResp.ok) {
                    log(`Successfully fetched ${res} resolution.`);
                    return await imgResp.blob();
                }
            } catch (e) {
                // Continue to next resolution
            }
        }

        // Fallback to original src
        try {
            const finalResp = await fetch(baseUrl);
            if (finalResp.ok) return await finalResp.blob();
        } catch (e) {
            log('Final cover fallback failed.', e);
        }
        return undefined;
    }

    private _enrichDatesWithUnix(meta: Partial<StoryMetadata>): void {
        if (!this._metaBlock) return;

        const timeNodes = this._metaBlock.querySelectorAll('[data-xutime]');

        if (meta.updated && timeNodes.length >= 2) {
            meta.updated = this._formatUnixDate(timeNodes[0].getAttribute('data-xutime'));
            meta.published = this._formatUnixDate(timeNodes[1].getAttribute('data-xutime'));
        } else if (timeNodes.length >= 1) {
            meta.published = this._formatUnixDate(timeNodes[0].getAttribute('data-xutime'));
        }
    }

    private _formatUnixDate(timestamp: string | null): string | undefined {
        if (!timestamp) return undefined;
        try {
            const date = new Date(parseInt(timestamp, 10) * 1000);
            return date.toISOString().split('T')[0];
        } catch (e) {
            return undefined;
        }
    }

    private _parseFFNMetadata(text: string): Partial<StoryMetadata> {
        const meta: Partial<StoryMetadata> = { status: 'In Progress' };
        if (!text) return meta;

        const parts = text.split(' - ').map(s => s.trim());
        parts.forEach(part => {
            if (part.startsWith('Rated:')) meta.rating = part.replace('Rated:', '').trim();
            else if (part.startsWith('Words:')) meta.words = part.replace('Words:', '').trim();
            else if (part.startsWith('Reviews:')) meta.reviews = part.replace('Reviews:', '').trim();
            else if (part.startsWith('Favs:')) meta.favs = part.replace('Favs:', '').trim();
            else if (part.startsWith('Follows:')) meta.follows = part.replace('Follows:', '').trim();
            else if (part.startsWith('Updated:')) meta.updated = part.replace('Updated:', '').trim();
            else if (part.startsWith('Published:')) meta.published = part.replace('Published:', '').trim();
            else if (part === 'Complete') meta.status = 'Complete';
            else if (part.startsWith('[')) meta.characters = part;
            else {
                if (['English', 'Spanish', 'French', 'German', 'Chinese', 'Japanese'].includes(part)) {
                    meta.language = part;
                } else if (part.includes('/') || /^[A-Z][a-z]+$/.test(part)) {
                    if (!meta.genre) meta.genre = part;
                }
            }
        });
        return meta;
    }
}