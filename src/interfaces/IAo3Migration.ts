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

export type Ao3MigrationMappingSource = 'auto' | 'manual' | 'unmapped';
export type Ao3MigrationRowStatus = 'mapped' | 'skipped' | 'duplicate';

export interface IAo3MigrationMappingRow {
    sourceItem: IBulkItem;
    selectedChapter: IAo3Chapter | null;
    mappingSource: Ao3MigrationMappingSource;
    status: Ao3MigrationRowStatus;
    modalRow: HTMLTableRowElement | null;
}

export interface IAo3MigrationPlan {
    normalizedWorkUrl: string;
    chapters: IAo3Chapter[];
    rows: IAo3MigrationMappingRow[];
    mappedCount: number;
    skippedCount: number;
    duplicateTargets: string[];
    convertLineBreaks: boolean;
    stripNotesMarker: string;
    hasBlockingErrors: boolean;
}

export interface IAo3MigrationFailure {
    sourceDoc: string;
    ao3Chapter: string;
    reason: string;
}
