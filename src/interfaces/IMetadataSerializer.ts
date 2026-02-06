// interfaces/IMetadataSerializer.ts

import { StoryMetadata } from './StoryMetadata';

/**
 * Interface for strategies that parse story metadata from different sources
 * (e.g., Local DOM, FicHub API, etc.).
 */
export interface IMetadataSerializer {
    /**
     * Parses the source data into a standardized StoryMetadata object.
     */
    serialize(): Promise<StoryMetadata>;

    /**
     * Returns the chapter count found in the source.
     */
    getChapterCount(): number;

    /**
     * Returns the last updated date found in the source.
     */
    getUpdatedDate(): Date;
}