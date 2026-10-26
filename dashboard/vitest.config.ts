import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react() as any],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'], globals: true },
});
