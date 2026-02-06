// serializers/FicHubMetadataSerializer.ts

import { IMetadataSerializer } from '../interfaces/IMetadataSerializer';
import { StoryMetadata } from '../interfaces/StoryMetadata';

/**
 * Serializer responsible for wrapping the FicHub API response.
 */
export class FicHubMetadataSerializer implements IMetadataSerializer {
    private _data: any;

    constructor(apiResponseJson: any) {
        this._data = apiResponseJson;
    }

    public getChapterCount(): number {
        return this._data.chapters || 0;
    }

    public getUpdatedDate(): Date {
        return this._data.updated ? new Date(this._data.updated) : new Date(0);
    }

    public async serialize(): Promise<StoryMetadata> {
        // FicHub returns a simplified metadata set. We map it to our internal structure.
        return {
            id: this._data.id,
            title: this._data.title,
            author: this._data.author,
            authorUrl: this._data.author_url,
            description: this._data.description,
            source: 'FicHub',
            storyUrl: this._data.source,
            status: this._data.status,
            // TODO: map other fields as necessary if FicHub provides them
        };
    }
}