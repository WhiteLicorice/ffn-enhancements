// === Shared bulk operation types and helper ===
export interface IBulkItem {
    docId: string;
    docName: string;
    title: string;
    row: HTMLTableRowElement;
}

export interface IBulkOperationResult<TItem = IBulkItem> {
    successCount: number;
    totalCount: number;
    retriedItems: TItem[];
}

export interface IBulkOperationConfig<TItem = IBulkItem> {
    verb: string;
    getItems: () => TItem[];
    filterRows?: (items: TItem[]) => TItem[];
    processItem: (item: TItem) => Promise<boolean>;
    onItemStart?: (item: TItem, pass: 1 | 2, index: number, total: number) => void;
    onItemSuccess?: (item: TItem, pass: 1 | 2) => void;
    onPermanentFailure?: (item: TItem) => void;
    preBatch?: (totalCount: number) => void;
    onFinalize?: (result: IBulkOperationResult<TItem>) => void | Promise<void>;
}
