import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: { manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'], charts: ['recharts'] } },
    },
  },
});
