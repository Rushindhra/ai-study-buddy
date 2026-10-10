import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser only talks to Vite; Vite forwards /api/* to the local Express backend.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
        // Local models can be slow; keep the proxy connection open long enough.
        timeout: 200000,
        proxyTimeout: 200000,
      },
    },
  },
});
