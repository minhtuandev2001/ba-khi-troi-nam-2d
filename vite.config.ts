import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  build: {
    target: ['es2020', 'chrome80', 'edge80', 'firefox78', 'safari14', 'ios14'],
    chunkSizeWarningLimit: 2000,
  },
});
