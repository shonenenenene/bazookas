// Снимает картинки-превью карт для меню: assets/previews/<карта>.jpg.
// Запуск: npm run previews (нужен установленный Google Chrome; путь можно задать переменной CHROME).
// Сам поднимает dev-сервер игры и Chrome без окна, открывает каждую карту в режиме съёмки (?preview=1 — камера
// в точке map.preview, без меню и HUD; в TrenchBroom — сущность info_preview) и сохраняет снимок.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const PORT = 5299; //        dev-сервер для съёмки (не мешает обычному npm run dev на 5173)
const DEBUG_PORT = 9339; //  порт управления Chrome
const SIZE = { w: 640, h: 360 };
const WAIT_MS = 3500; //     ждём после загрузки карты: картинки лун, первые кадры

function findChrome(): string {
  const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('Не нашёл Chrome. Укажи путь: CHROME=путь/к/chrome npm run previews');
  return found;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // ещё не поднялся
    }
    await sleep(500);
  }
  throw new Error(`Не дождался ${url}`);
}

const maps = [...readdirSync('assets/maps').filter((f) => f.endsWith('.map')).map((f) => f.slice(0, -4)), 'test_arena'];
mkdirSync('assets/previews', { recursive: true });

const children: ChildProcess[] = [];
const cleanup = () => {
  for (const c of children) c.kill();
};
process.on('exit', cleanup);

try {
  // Dev-сервер игры (через node, без npx — так одинаково работает на любой системе)
  children.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' }));
  await waitFor(`http://localhost:${PORT}/`);

  // Chrome без окна; программная отрисовка (swiftshader) — работает и без видеокарты
  const profile = mkdtempSync(join(tmpdir(), 'bazookas-previews-'));
  children.push(spawn(findChrome(), [
    '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio',
    `--window-size=${SIZE.w},${SIZE.h}`, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' }));
  await waitFor(`http://localhost:${DEBUG_PORT}/json/version`);

  // Протокол отладки Chrome: команда — JSON с номером, ответ приходит с тем же номером
  const pages = (await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const ws = new WebSocket(pages.find((p) => p.type === 'page')!.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let nextId = 0;
  const waiting = new Map<number, (result: { data?: string }) => void>();
  ws.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id) waiting.get(msg.id)?.(msg.result);
  });
  const send = (method: string, params: object = {}) =>
    new Promise<{ data?: string }>((resolve) => {
      const id = ++nextId;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  // Ровно SIZE пикселей (окно Chrome без окна чуть меньше заданного)
  await send('Emulation.setDeviceMetricsOverride', { width: SIZE.w, height: SIZE.h, deviceScaleFactor: 1, mobile: false });
  for (const name of maps) {
    await send('Page.navigate', { url: `http://localhost:${PORT}/?map=${name}&preview=1` });
    await sleep(WAIT_MS);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    writeFileSync(`assets/previews/${name}.jpg`, Buffer.from(shot.data!, 'base64'));
    console.log(`assets/previews/${name}.jpg`);
  }
  ws.close();
} finally {
  cleanup();
}
process.exit(0);
