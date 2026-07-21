import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    setupFiles: ['tests/setup.ts'],
    env: {
      JWT_SECRET: 'test-jwt-secret-for-unit-tests',
      DB_PATH: ':memory:',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
      LOG_LEVEL: 'ERROR',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
  resolve: {
    extensions: ['.ts', '.js', '.mjs'],
  },
});
