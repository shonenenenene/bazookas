import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Plugin, defineConfig } from 'vite';

export default defineConfig({
  plugins: [maps()],
  server: {
    port: 5173,
    open: true, // открыть браузер при `npm run dev`
    // Сетевая игра: /ws (соединение) и /api (список комнат) пересылаем на игровой сервер (npm run server).
    // Так друзьям в локальной сети хватает одного адреса игры
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true }, '/api': 'http://localhost:8080' },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800, // сам Three.js весит ~500 КБ, плюс тексты карт (~200 КБ) — это нормально
  },
});

/**
 * Карты из TrenchBroom: `import files from 'virtual:maps'` → { speedway: 'текст speedway.map', … }.
 * Обычный import файла .map не подходит: Vite принимает .map за source map и отдаёт его как JSON.
 * Сохранил/добавил карту в assets/maps — страница перезагрузится сама.
 */
function maps(): Plugin {
  const id = 'virtual:maps';
  const resolved = '\0' + id;
  const dir = resolve('assets/maps');
  return {
    name: 'bazookas-maps',
    resolveId: (source) => (source === id ? resolved : undefined),
    load(loadId) {
      if (loadId !== resolved) return;
      const files: Record<string, string> = {};
      const names = existsSync(dir) ? readdirSync(dir) : [];
      for (const f of names.filter((f) => f.endsWith('.map'))) {
        files[f.slice(0, -'.map'.length)] = readFileSync(resolve(dir, f), 'utf8');
      }
      return `export default ${JSON.stringify(files)};`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      const reload = (file: string) => {
        if (!resolve(file).startsWith(dir) || !file.endsWith('.map')) return;
        const mod = server.moduleGraph.getModuleById(resolved);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload).on('change', reload).on('unlink', reload);
    },
  };
}
