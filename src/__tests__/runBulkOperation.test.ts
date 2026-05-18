import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbortBulkOperation, runBulkOperation } from '../utils/runBulkOperation';
import { SettingsManager } from '../modules/SettingsManager';

describe('runBulkOperation abort handling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function makeEvent(button: HTMLButtonElement): MouseEvent {
        return { currentTarget: button } as unknown as MouseEvent;
    }

    function mockDelays(): void {
        vi.spyOn(SettingsManager, 'get').mockImplementation((key) => {
            if (key === 'bulkExportDelayMs' || key === 'bulkCooldownMs' || key === 'bulkRetryDelayMs') {
                return 0 as never;
            }
            return 0 as never;
        });
    }

    it('marks retry candidates, current item, and remaining items on a pass-1 abort', async () => {
        mockDelays();
        const permanentFailures: string[] = [];
        const finalize = vi.fn();
        const items = ['a', 'b', 'c'];
        const button = document.createElement('button');

        await runBulkOperation(makeEvent(button), {
            verb: 'Test',
            getItems: () => items,
            processItem: vi.fn(async (item: string) => {
                if (item === 'a') return false;
                if (item === 'b') throw new AbortBulkOperation('stop now');
                return true;
            }),
            onPermanentFailure: (item) => {
                permanentFailures.push(item);
            },
            onFinalize: finalize,
        });

        expect(permanentFailures).toEqual(['a', 'b', 'c']);
        expect(finalize).toHaveBeenCalledWith({
            successCount: 0,
            totalCount: 3,
            retriedItems: ['a'],
            aborted: true,
            abortReason: 'stop now',
        });
    });

    it('finalizes and marks remaining retry items on a pass-2 abort', async () => {
        mockDelays();
        const permanentFailures: string[] = [];
        const finalize = vi.fn();
        const items = ['a', 'b', 'c'];
        const button = document.createElement('button');
        const attempts = new Map<string, number>();

        await runBulkOperation(makeEvent(button), {
            verb: 'Test',
            getItems: () => items,
            processItem: vi.fn(async (item: string) => {
                const attempt = (attempts.get(item) || 0) + 1;
                attempts.set(item, attempt);
                if (attempt === 1) return false;
                if (item === 'a') return false;
                if (item === 'b') throw new AbortBulkOperation('retry stop');
                return true;
            }),
            onPermanentFailure: (item) => {
                permanentFailures.push(item);
            },
            onFinalize: finalize,
        });

        expect(permanentFailures).toEqual(['a', 'b', 'c']);
        expect(finalize).toHaveBeenCalledWith({
            successCount: 0,
            totalCount: 3,
            retriedItems: ['a', 'b', 'c'],
            aborted: true,
            abortReason: 'retry stop',
        });
    });
});
