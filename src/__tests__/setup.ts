import { vi } from 'vitest';

vi.mock('file-saver', () => ({
    saveAs: vi.fn(),
}));
