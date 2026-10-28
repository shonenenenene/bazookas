import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: true, // открыть браузер при `npm run dev`
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700, // сам Three.js весит ~500 КБ, это нормально
  },
});
