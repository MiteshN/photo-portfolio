import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // The library tests encode real images; run files one at a time to keep it predictable.
    fileParallelism: false,
  },
});
