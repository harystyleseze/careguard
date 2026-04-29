import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      '**/__tests__/**/*.test.ts',
      '**/test/**/*.test.ts',
      'services/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html', 'json-summary'],
      include: ['agent/**/*.ts', 'services/**/*.ts', 'shared/**/*.ts', 'dashboard/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/node_modules/**', '**/__tests__/**', '**/test/**'],
    },
  },
});
