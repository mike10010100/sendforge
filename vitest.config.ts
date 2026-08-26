import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'node',
    maxWorkers: 4,
    include: [
      'client/test/**/*.test.ts',
      'client/test/**/*.test.tsx',
      'client/tests/**/*.test.ts',
      'client/tests/**/*.test.tsx',
    ],
  },
});
