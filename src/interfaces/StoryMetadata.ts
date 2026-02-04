// interfaces/StoryMetadata.ts

export interface StoryMetadata {
    id: string;
    title: string;
    author: string;
    authorUrl?: string;
    description: string;
    source: string;
    /** The clickable URL of the story (normalized to be always chapter 1) */
    storyUrl?: string;
    /** Optional blob data for the cover image */
    coverBlob?: Blob;
}