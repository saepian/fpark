import { defineConfig } from 'vitest/config';
import path from 'path';

// tsconfig.json의 "@/*": ["./*"] 경로 별칭을 그대로 반영.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next', '.e2e-tmp'],
  },
});
