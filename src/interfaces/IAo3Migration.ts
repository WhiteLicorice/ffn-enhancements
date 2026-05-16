import type { IBulkItem } from './IBulkOperationConfig';

export interface IAo3Chapter {
    workId: string;
    chapterId: string;
    chapterNumber: number;
    label: string;
    title: string;
    readerUrl: string;
    editUrl: string;
}

export type Ao3MigrationMappingSource = 'auto' | 'autofill' | 'manual' | 'unmapped';
export type Ao3MigrationRowStatus = 'mapped' | 'skipped' | 'duplicate';

export interface IAo3MigrationMappingRow {
    chapter: IAo3Chapter;
    selectedSourceItem: IBulkItem | null;
    mappingSource: Ao3MigrationMappingSource;
    hasBeenAutofilled: boolean;
    status: Ao3MigrationRowStatus;
    modalRow: HTMLTableRowElement | null;
}

export interface IAo3MigrationPlan {
    normalizedWorkUrl: string;
    chapters: IAo3Chapter[];
    rows: IAo3MigrationMappingRow[];
    mappedCount: number;
    skippedCount: number;
    duplicateSourceDocIds: string[];
    convertLineBreaks: boolean;
    stripNotesMarker: string;
    hasBlockingErrors: boolean;
}

export interface IAo3MigrationFailure {
    sourceDoc: string;
    ao3Chapter: string;
    reason: string;
}
