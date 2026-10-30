// Игровой сервер: раздаёт саму игру (собранную, из dist/), список комнат (/api/rooms) и принимает игроков
// по WebSocket (/ws), раскладывает по комнатам и крутит их 60 раз в секунду.
// Запуск: npm run server (в разработке игру раздаёт Vite, сервер — только /ws и /api).
// Клиент подключается к ws://адрес/ws?room=имя&name=ник&map=карта&v=версия[&public=1]

import { existsSync, readFileSync, statSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type WebSocket, WebSocketServer } from 'ws';
import { TICK_DT } from '../shared/config';
import { cleanMapName, loadMap, mapNames } from '../shared/maps/registry';
import { CLOSE, PROTOCOL_VERSION, cleanRoomName } from '../shared/net/protocol';
import { SERVER } from './config';
import { readMapFiles } from './maps';
import { Room } from './room';

const rooms = new Map<string, Room>();

// ─── Смена карт после матча ───────────────────────────────────

/**
 * Карты для смены после матча: все, кроме тренировочных (training 1 в worldspawn, у тестовой арены — в коде), по алфавиту.
 * Карты разбираем целиком — раз в матч, это недорого.
 */
function rotation(): string[] {
  const files = readMapFiles();
  return mapNames(files).filter((name) => !loadMap(name, files).training);
}

/** Следующая карта после current. Текущая тренировочная (её нет в списке) — остаёмся на ней. */
function nextMap(current: string): string | null {
  const list = rotation();
  const i = list.indexOf(current);
  return i < 0 || list.length < 2 ? null : list[(i + 1) % list.length];
}

// ─── HTTP: игра из dist/ и список комнат ────────────────────────

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

function serveFile(req: IncomingMessage, res: ServerResponse): void {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  // normalize + проверка префикса — чтобы ../../ не вывели за пределы dist
  let file = normalize(DIST + (path === '/' ? 'index.html' : path));
  if (!file.startsWith(normalize(DIST))) file = '';
  if (!file || !existsSync(file) || !statSync(file).isFile()) file = normalize(DIST + 'index.html');
  if (!existsSync(file)) {
    res.end(`the bazookas server: ok. rooms: ${rooms.size} (no dist/ — run npm run build)`);
    return;
  }
  // У файлов из assets/ в имени хэш содержимого — их можно кэшировать навсегда; index.html — никогда
  const immutable = file.includes(`${normalize('/assets/')}`);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(readFileSync(file));
}

const http = createServer((req, res) => {
  if (req.url?.startsWith('/api/rooms')) {
    // Открытые комнаты для лобби: сначала самые полные (туда интереснее зайти)
    const list = [...rooms.values()].filter((r) => r.public && !r.closing).map((r) => r.info());
    list.sort((a, b) => b.players - a.players);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ version: PROTOCOL_VERSION, maxPlayers: SERVER.maxPlayers, rooms: list }));
    return;
  }
  serveFile(req, res);
});

// ─── WebSocket ────────────────────────────────────────────────

// maxPayload — защита от гигантских сообщений: наши команды весят ~16 байт
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 1024 });

// Пульс: раз в 10 с пингуем каждый сокет (браузер отвечает сам, даже из фоновой вкладки).
// Не ответил — соединение мёртвое (вкладку убили, пропал интернет), выкидываем,
// иначе в комнате навсегда останется «призрак»
const alive = new WeakSet<WebSocket>();
setInterval(() => {
  for (const socket of wss.clients) {
    if (!alive.has(socket)) {
      socket.terminate(); // сработает socket.on('close') ниже — игрок выйдет из комнаты
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, SERVER.heartbeat * 1000);

/** Соединений с каждого адреса — для SERVER.maxConnectionsPerIp */
const perIp = new Map<string, number>();

function clientIp(req: IncomingMessage): string {
  const forwarded = SERVER.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return forwarded || req.socket.remoteAddress || '?';
}

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // Старая вкладка (открыта до обновления сервера) — пусть перезагрузится
  if (Number(url.searchParams.get('v')) !== PROTOCOL_VERSION) {
    socket.close(CLOSE.VERSION, 'new version');
    return;
  }
  const ip = clientIp(req);
  if ((perIp.get(ip) ?? 0) >= SERVER.maxConnectionsPerIp) {
    socket.close(CLOSE.LIMIT, 'too many tabs from ur ip');
    return;
  }

  const roomName = cleanRoomName(url.searchParams.get('room') ?? '');
  let room = rooms.get(roomName);
  if (!room) {
    if (rooms.size >= SERVER.maxRooms) {
      socket.close(CLOSE.LIMIT, 'server is full of rooms, try later');
      return;
    }
    // Карту и открытость выбирает тот, кто создал комнату (?map=, ?public=1). Остальные попадают на неё же,
    // даже если в их ссылке другая: клиент узнает карту из WELCOME и перезагрузится на неё
    const map = loadMap(cleanMapName(url.searchParams.get('map') ?? ''), readMapFiles());
    room = new Room(roomName, map, { public: url.searchParams.get('public') === '1', nextMap });
    rooms.set(roomName, room);
    console.log(`[${roomName}] новая комната, карта ${map.name}${room.public ? ', открытая' : ''}`);
  }

  const client = room.join({ send: (data) => socket.send(data) }, url.searchParams.get('name') ?? '');
  if (!client) {
    socket.close(CLOSE.FULL, 'room is full');
    if (room.size === 0) rooms.delete(roomName);
    return;
  }
  const joined = room;
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  alive.add(socket);
  socket.on('pong', () => alive.add(socket));
  console.log(`[${roomName}] + ${client.player.name} (в комнате: ${joined.size})`);

  socket.on('message', (data, isBinary) => {
    if (isBinary) joined.receive(client, data as Buffer);
  });
  socket.on('close', () => {
    joined.leave(client);
    const left = (perIp.get(ip) ?? 1) - 1;
    if (left > 0) perIp.set(ip, left);
    else perIp.delete(ip);
    console.log(`[${roomName}] − ${client.player.name} (в комнате: ${joined.size})`);
    if (joined.size === 0 && rooms.get(roomName) === joined) rooms.delete(roomName);
  });
});

// Цикл: копим реальное время и делаем столько тиков, сколько набежало (таймеры Node не точные)
let last = performance.now();
let accumulator = 0;
setInterval(() => {
  const now = performance.now();
  accumulator += Math.min(now - last, 250) / 1000; // после долгого подвисания не «догоняем» сотни тиков
  last = now;
  while (accumulator >= TICK_DT) {
    for (const [name, room] of rooms) {
      room.tick();
      // Комната ушла на другую карту (клиентам отправлен MAP, они перезагружаются): убираем её —
      // первый вернувшийся создаст её заново, уже на новой карте (она в его адресе)
      if (room.closing) rooms.delete(name);
    }
    accumulator -= TICK_DT;
  }
}, 4);

http.listen(SERVER.port, () => {
  console.log(`The Bazookas server: http://localhost:${SERVER.port} (игра — из dist/, если собрана), ws://localhost:${SERVER.port}/ws`);
});
