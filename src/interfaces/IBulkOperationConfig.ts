// === Shared bulk operation types and helper ===
export interface IBulkItem {
    docId: string;
    title: string;
    row: HTMLTableRowElement;
}
export interface IBulkOperationConfig {
    verb: string;
    filterRows?: (items: IBulkItem[]) => IBulkItem[];
    processItem: (item: IBulkItem) => Promise<boolean>;
    onItemSuccess?: (item: IBulkItem, pass: 1 | 2) => void;
    onPermanentFailure?: (item: IBulkItem) => void;
    preBatch?: (totalCount: number) => void;
    onFinalize?: (result: { successCount: number; totalCount: number; retriedItems: IBulkItem[]; }) => void | Promise<void>;
}
