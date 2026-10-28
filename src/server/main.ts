// Игровой сервер: принимает игроков по WebSocket, раскладывает по комнатам и крутит их 60 раз в секунду.
// Запуск: npm run server. Клиент подключается к ws://адрес:8080/ws?room=имя&name=ник

import { createServer } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import { TICK_DT } from '../shared/config';
import { cleanRoomName } from '../shared/net/protocol';
import { SERVER } from './config';
import { Room } from './room';

const rooms = new Map<string, Room>();

// Обычный HTTP-ответ — чтобы в браузере по адресу сервера было видно, что он жив
const http = createServer((_req, res) => {
  res.end(`the bazookas server: ok. rooms: ${rooms.size}`);
});

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

wss.on('connection', (socket, req) => {
  alive.add(socket);
  socket.on('pong', () => alive.add(socket));

  const url = new URL(req.url ?? '/', 'http://localhost');
  const roomName = cleanRoomName(url.searchParams.get('room') ?? '');
  const room = rooms.get(roomName) ?? new Room(roomName);
  rooms.set(roomName, room);

  const client = room.join({ send: (data) => socket.send(data) }, url.searchParams.get('name') ?? '');
  if (!client) {
    socket.close(4001, 'room is full');
    if (room.size === 0) rooms.delete(roomName);
    return;
  }
  console.log(`[${roomName}] + ${client.player.name} (в комнате: ${room.size})`);

  socket.on('message', (data, isBinary) => {
    if (isBinary) room.receive(client, data as Buffer);
  });
  socket.on('close', () => {
    room.leave(client);
    console.log(`[${roomName}] − ${client.player.name} (в комнате: ${room.size})`);
    if (room.size === 0) rooms.delete(roomName);
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
    for (const room of rooms.values()) room.tick();
    accumulator -= TICK_DT;
  }
}, 4);

http.listen(SERVER.port, () => {
  console.log(`The Bazookas server: ws://localhost:${SERVER.port}/ws`);
});
