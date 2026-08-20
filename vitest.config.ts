import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'node',
    include: ['client/tests/**/*.test.ts', 'client/tests/**/*.test.tsx'],
  },
});
