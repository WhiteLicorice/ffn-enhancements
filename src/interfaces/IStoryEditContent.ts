export const STORY_EDIT_CONTENT_CHAPTER_ID_ATTR = 'data-ffne-story-text-id';

export interface IStoryEditContentChapter {
    storyTextId: string;
    chapterNumber: number;
    chapterLabel: string;
    published: boolean;
    row: HTMLTableRowElement | null;
}

export interface IStoryEditContentDoc {
    docId: string;
    docName: string;
}

export type StoryEditContentMappingSource = 'unmapped' | 'manual' | 'autofill';
export type StoryEditContentMappingStatus = 'unmapped' | 'mapped' | 'duplicate' | 'running' | 'success' | 'failed' | 'skipped';

export interface IStoryEditContentMappingRow {
    chapter: IStoryEditContentChapter;
    selectedDocId: string;
    selectedDocName: string;
    source: StoryEditContentMappingSource;
    hasBeenAutofilled: boolean;
    status: StoryEditContentMappingStatus;
    modalRow: HTMLTableRowElement | null;
}

export interface IStoryEditContentPlan {
    rows: IStoryEditContentMappingRow[];
    mappedCount: number;
    skippedCount: number;
    duplicateDocIds: string[];
    hasBlockingErrors: boolean;
}

export interface IStoryEditContentFailure {
    chapterLabel: string;
    docName: string;
    reason: string;
}
