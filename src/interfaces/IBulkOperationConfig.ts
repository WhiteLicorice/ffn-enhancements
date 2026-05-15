// === Shared bulk operation types and helper ===
export interface IBulkItem {
    docId: string;
    docName: string;
    title: string;
    row: HTMLTableRowElement;
}
export interface IBulkOperationConfig {
    verb: string;
    filterRows?: (items: IBulkItem[]) => IBulkItem[];
    processItem: (item: IBulkItem) => Promise<boolean>;
    onItemStart?: (item: IBulkItem, pass: 1 | 2, index: number, total: number) => void;
    onItemSuccess?: (item: IBulkItem, pass: 1 | 2) => void;
    onPermanentFailure?: (item: IBulkItem) => void;
    preBatch?: (totalCount: number) => void;
    onFinalize?: (result: { successCount: number; totalCount: number; retriedItems: IBulkItem[]; }) => void | Promise<void>;
}
