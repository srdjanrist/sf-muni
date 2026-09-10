import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001', '/map-assets': 'http://127.0.0.1:3001' },
  },
  build: {
    outDir: 'dist/client',
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules\/maplibre-gl/ },
            { name: 'three', test: /node_modules\/three/ },
          ],
        },
      },
    },
  },
});
