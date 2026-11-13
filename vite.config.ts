import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.OPENSHELL_UI_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  server: {
    port: 5273,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  plugins: [react()],
});
