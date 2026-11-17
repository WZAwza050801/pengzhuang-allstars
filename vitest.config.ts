import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['**/*.contract.test.ts', '**/*.integration.test.ts'],
        },
      },
      { test: { name: 'contract', environment: 'node', include: ['tests/**/*.contract.test.ts'] } },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/**/*.integration.test.ts'],
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
    ],
  },
});
