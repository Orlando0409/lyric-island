import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/main/protocol.ts', 'src/main/cache.ts'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 75 },
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
