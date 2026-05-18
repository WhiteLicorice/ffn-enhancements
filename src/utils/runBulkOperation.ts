import { IBulkOperationConfig } from '../interfaces/IBulkOperationConfig';
import { Core } from '../modules/Core';
import { SettingsManager } from '../modules/SettingsManager';

export class AbortBulkOperation extends Error {
    public readonly reason: string;
    constructor(reason: string) {
        super(`Bulk operation aborted: ${reason}`);
        this.name = 'AbortBulkOperation';
        this.reason = reason;
    }
}

export async function runBulkOperation<TItem>(e: MouseEvent, config: IBulkOperationConfig<TItem>): Promise<void> {
    const log = Core.getLogger('bulk-runner', 'runBulkOperation');
    const { verb, processItem, onItemStart, onItemSuccess, onPermanentFailure, preBatch, onFinalize } = config;

    log(`${verb} initiated.`);
    const btn = e.currentTarget as HTMLButtonElement | null;

    let items = config.getItems();
    if (config.filterRows) {
        items = config.filterRows(items);
    }

    if (items.length === 0) {
        log(`No items to ${verb.toLowerCase()}.`);
        return;
    }

    if (preBatch) preBatch(items.length);

    const originalText = btn?.innerText || '';
    if (btn) {
        btn.disabled = true;
        btn.style.cursor = 'wait';
        btn.style.opacity = '1';
    }

    let successCount = 0;
    const retriedItems: TItem[] = [];
    let abortReason: string | null = null;
    const permanentlyFailedItems = new Set<TItem>();
    const markPermanentFailure = (item: TItem) => {
        if (permanentlyFailedItems.has(item)) return;
        permanentlyFailedItems.add(item);
        onPermanentFailure?.(item);
    };

    try {
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (btn) btn.innerText = `${i + 1}/${items.length}`;
            if (onItemStart) onItemStart(item, 1, i + 1, items.length);

            await new Promise(r => setTimeout(r, SettingsManager.get('bulkExportDelayMs')));

            try {
                if (await processItem(item)) {
                    successCount++;
                    if (onItemSuccess) onItemSuccess(item, 1);
                } else {
                    retriedItems.push(item);
                }
            } catch (err) {
                if (err instanceof AbortBulkOperation) {
                    abortReason = err.reason;
                    log(`Bulk operation aborted: ${abortReason}`);
                    retriedItems.forEach(markPermanentFailure);
                    markPermanentFailure(item);
                    for (let j = i + 1; j < items.length; j++) {
                        markPermanentFailure(items[j]);
                    }
                    break;
                }
                throw err;
            }
        }

        if (!abortReason && retriedItems.length > 0) {
            log(`Pass 1 done. ${retriedItems.length} items failed. Cooling...`);
            if (btn) btn.innerText = 'Cooling...';
            await new Promise(r => setTimeout(r, SettingsManager.get('bulkCooldownMs')));

            for (let i = 0; i < retriedItems.length; i++) {
                const item = retriedItems[i];
                if (btn) btn.innerText = `Retry ${i + 1}/${retriedItems.length}`;
                if (onItemStart) onItemStart(item, 2, i + 1, retriedItems.length);

                await new Promise(r => setTimeout(r, SettingsManager.get('bulkRetryDelayMs')));

                try {
                    if (await processItem(item)) {
                        successCount++;
                        if (onItemSuccess) onItemSuccess(item, 2);
                    } else {
                        markPermanentFailure(item);
                    }
                } catch (err) {
                    if (err instanceof AbortBulkOperation) {
                        abortReason = err.reason;
                        log(`Bulk operation aborted during retry pass: ${abortReason}`);
                        markPermanentFailure(item);
                        for (let j = i + 1; j < retriedItems.length; j++) {
                            markPermanentFailure(retriedItems[j]);
                        }
                        break;
                    }
                    throw err;
                }
            }
        }

        if (onFinalize) {
            await onFinalize({
                successCount,
                totalCount: items.length,
                retriedItems,
                aborted: abortReason !== null ? true : undefined,
                abortReason: abortReason ?? undefined,
            });
        }
    } catch (error) {
        log(`Error during bulk ${verb}.`, error);
        if (btn) btn.innerText = 'Error';
    } finally {
        if (btn) {
            setTimeout(() => {
                btn.innerText = originalText;
                btn.disabled = false;
                btn.style.cursor = 'pointer';
                btn.style.opacity = '0.6';
            }, 3000);
        }
    }
}
