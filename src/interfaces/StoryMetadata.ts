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

    rating?: string;
    language?: string;
    genre?: string;
    characters?: string;
    words?: string;
    reviews?: string;
    favs?: string;
    follows?: string;
    updated?: string;
    published?: string;
    status?: string; // 'Complete' or 'In Progress'
}