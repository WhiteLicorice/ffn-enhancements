// interfaces/StoryMetadata.ts

export interface StoryMetadata {
    id: string;
    title: string;
    author: string;
    description: string;
    source: string;
    /** Optional blob data for the cover image */
    coverBlob?: Blob;
}