import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '$': path.resolve(__dirname, 'src/__tests__/__mocks__/dollar.ts'),
        },
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/__tests__/setup.ts'],
        include: ['src/**/*.test.ts'],
    },
});
