import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: true, // открыть браузер при `npm run dev`
    // Сетевая игра: адрес /ws пересылаем на игровой сервер (npm run server).
    // Так друзьям в локальной сети хватает одного адреса игры
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700, // сам Three.js весит ~500 КБ, это нормально
  },
});
