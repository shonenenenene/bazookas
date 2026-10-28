// Проверки сети без браузера и без настоящих сокетов: сервер (Room) и клиенты (OnlineSession)
// общаются через «провод» с задержкой. Главное — предсказание движения совпадает с сервером.

import { type NetLink, OnlineSession } from '../src/client/net/online';
import { Room, type RoomClient } from '../src/server/room';
import { MOVE } from '../src/shared/config';
import { testMap } from '../src/shared/maps/testMap';
import { distSq, lengthXZ, vec3 } from '../src/shared/math';
import { type Message, Reader, Writer } from '../src/shared/net/binary';
import { MSG, createSnapshot, readCmd, readSnapshot, writeCmd, writeSnapshot } from '../src/shared/net/protocol';
import { type UserCmd, copyUserCmd, createUserCmd, spawnPlayer } from '../src/shared/player';
import { type GameEvent, type Player, type World, addPlayer, createWorld, findPlayer } from '../src/shared/world';
import { check, round } from './check';

console.log('\n── сеть ──');

const DEG = Math.PI / 180;
/** Задержка провода в одну сторону, тиков: 3 тика = 50 мс, то есть пинг 100 мс */
const DELAY = 3;

let now = 0;

/** Провод: сообщения доходят через DELAY тиков. */
class Wire {
  private queue: { at: number; data: Message }[] = [];
  push(data: Message): void {
    this.queue.push({ at: now + DELAY, data });
  }
  deliver(fn: (data: Message) => void): void {
    while (this.queue.length > 0 && this.queue[0].at <= now) fn(this.queue.shift()!.data);
  }
}

interface TestClient {
  world: World;
  me: Player;
  session: OnlineSession;
  server: RoomClient;
  up: Wire;
  down: Wire;
  link: NetLink;
  /** Что «нажимает» игрок — сценарий проверки */
  keys: UserCmd;
  /** События, которые получил бы effects.ts */
  events: GameEvent[];
}

function connect(room: Room, name: string): TestClient {
  const world = createWorld(testMap, { dummies: false, authority: false });
  const me = addPlayer(world, name, testMap.spawns[0]);
  const up = new Wire();
  const down = new Wire();
  const link: NetLink = { inbox: [], send: (d) => up.push(d) };
  const server = room.join({ send: (d) => down.push(d) }, name)!;
  return { world, me, session: new OnlineSession(world, me, link), server, up, down, link, keys: createUserCmd(), events: [] };
}

/** Один тик всего сразу: доставка сообщений, клиенты, сервер. */
function step(room: Room, clients: TestClient[]): void {
  for (const c of clients) {
    c.up.deliver((d) => room.receive(c.server, d));
    c.down.deliver((d) => c.link.inbox.push(d));
    c.session.tick({ fillCmd: (cmd) => copyUserCmd(cmd, c.keys) });
    c.events.push(...c.world.events);
    c.world.events.length = 0;
  }
  room.tick();
  now++;
}

function run(room: Room, clients: TestClient[], ticks: number, each?: () => void): void {
  for (let i = 0; i < ticks; i++) {
    each?.();
    step(room, clients);
  }
}

// ─── Протокол: что записали, то и прочитали ───
{
  const w = new Writer();
  const r = new Reader();
  const cmd: UserCmd = { forward: 1, right: -1, jump: true, crouch: true, fire: false, weapon: 2, yaw: 1.2345, pitch: -0.5 };
  writeCmd(w, 77, cmd);
  r.reset(w.finish());
  const type = r.u8();
  const out = createUserCmd();
  const seq = readCmd(r, out);
  const ok = type === MSG.CMD && seq === 77 && out.forward === 1 && out.right === -1 && out.jump && out.crouch && !out.fire &&
    out.weapon === 2 && out.yaw === Math.fround(1.2345);
  check('cmd roundtrip', ok, `seq=${seq} yaw=${out.yaw}`);

  const world = createWorld(testMap);
  const me = world.players[1];
  me.state.origin.x = 123.456789012345;
  const kill: GameEvent = { type: 'kill', targetId: 3, attackerId: -1, weapon: -1, pos: vec3(1, 2, 3) };
  writeSnapshot(w, world, me, 42, [{ tick: 7, event: kill }]);
  r.reset(w.finish());
  r.u8();
  const snap = createSnapshot();
  readSnapshot(r, snap);
  const e = snap.events[0]?.event;
  const ok2 = snap.ack === 42 && snap.me.origin.x === me.state.origin.x && snap.playerCount === world.players.length &&
    e?.type === 'kill' && e.attackerId === -1 && e.pos.z === 3;
  check('snapshot roundtrip', ok2, `players=${snap.playerCount} event=${e?.type}`);
}

const room = new Room('test');
const a = connect(room, 'alice');

// ─── Подключение: сервер принял, прислал всех (с манекенами) ───
run(room, [a], 30);
check(
  'net welcome',
  a.session.ready && a.me.id === a.server.player.id && a.world.players.length === 1 + testMap.dummies.length && a.session.humans === 1,
  `ready=${a.session.ready} players=${a.world.players.length} humans=${a.session.humans}`,
);

// ─── Предсказание: бег, банни-хоп со стрейфами, ступеньки — клиент считает ровно как сервер ───
{
  // Смотрим туда, куда развернул сервер при появлении (в игре это делает effects.ts)
  const spawned = a.events.find((e) => e.type === 'spawn' && e.playerId === a.me.id);
  a.keys.yaw = spawned?.type === 'spawn' ? spawned.yaw : 0;
  a.session.predictor.largestCorrection = 0; // первая поправка — переезд на точку появления, она не в счёт
  a.keys.forward = 1;
  run(room, [a], 60);
  a.keys.forward = 0;
  a.keys.right = 1;
  let top = 0;
  run(room, [a], 240, () => {
    a.keys.jump = a.me.state.onGround && !a.keys.jump; // жмём пробел в первый тик на земле
    const v = a.me.state.velocity;
    const len = lengthXZ(v) || 1;
    a.keys.yaw = Math.atan2(v.x / len, v.z / len); // стрейф перпендикулярно скорости
    a.keys.weapon = (now >> 5) % 4; //                 и базуки переключаем на ходу
    top = Math.max(top, lengthXZ(v));
  });
  Object.assign(a.keys, { right: 0, jump: false });
  run(room, [a], 60);
  const corr = a.session.predictor.largestCorrection;
  const gap = Math.sqrt(distSq(a.me.state.origin, a.server.player.state.origin));
  check('net prediction', corr < 0.001 && gap < 0.001 && top > 330, `max correction=${corr} gap=${round(gap)} top speed=${round(top)}`);
}

// ─── Рокет-джамп по сети: своя ракета вылетает сразу, толчок предсказан — сервер с ним согласен ───
{
  run(room, [a], 30); // встали
  a.events.length = 0;
  a.session.predictor.largestCorrection = 0;
  const baseY = a.me.state.origin.y;
  Object.assign(a.keys, { pitch: -89 * DEG, jump: true, fire: true, weapon: 0 });
  run(room, [a], 1);
  const instant = a.world.predictedRockets.length === 1; // в тот же тик, без пинга
  Object.assign(a.keys, { jump: false, fire: false });
  let height = 0;
  let riseTicks = -1; // через сколько тиков после выстрела подбросило (без предсказания — пинг + снимок, ~10)
  for (let i = 1; i <= 150; i++) {
    run(room, [a], 1);
    height = Math.max(height, a.me.state.origin.y - baseY);
    if (riseTicks < 0 && a.me.state.velocity.y > 400) riseTicks = i;
  }
  const exploded = a.events.filter((e) => e.type === 'explode').length;
  const fired = a.events.filter((e) => e.type === 'fire').length;
  const corr = a.session.predictor.largestCorrection;
  check(
    'net rocket jump',
    instant && exploded === 1 && fired === 1 && height > 150 && riseTicks > 0 && riseTicks <= 5 && corr < 0.01,
    `rocket at once=${instant} lifted after ${riseTicks} ticks height=${round(height)} explodes=${exploded} max correction=${round(corr)}`,
  );

  a.session.predictor.largestCorrection = 0;
  run(room, [a], 60);
  check('net settles', a.session.predictor.largestCorrection < 0.001, `max correction=${a.session.predictor.largestCorrection}`);
}

// ─── Паркур по сети: отскок (поздний и вовремя), подкат — клиент считает ровно как сервер ───
{
  const EAST = -Math.PI / 2; // yaw: смотрим в +X — на стену коридора (x = 250)
  spawnPlayer(a.server.player.state, { feet: vec3(60, 0, 480), yaw: EAST });
  Object.assign(a.keys, { yaw: EAST, pitch: 0, forward: 0, right: 0, jump: false, crouch: false });
  run(room, [a], 20); // клиент получил новое место (это поправка — не в счёт)
  a.session.predictor.largestCorrection = 0;

  const s = a.me.state;
  let slid = false;
  const watch = () => {
    slid ||= s.sliding;
  };
  const tap = () => {
    a.keys.jump = true;
    run(room, [a], 1, watch);
    a.keys.jump = false;
  };

  // 1) Разбег к стене, прыжок, поздний отскок (через 0.25 с у стены) — без ускорения, приземление присев — подкат
  a.keys.forward = 1;
  run(room, [a], 25, watch);
  tap();
  for (let i = 0; i < 60 && !s.wallTouch; i++) run(room, [a], 1, watch);
  run(room, [a], 15, watch); // сползаем по стене, упираясь в неё
  a.keys.forward = 0;
  tap();
  const late = Math.abs(lengthXZ(s.velocity) - MOVE.wallJumpPush) < 1;
  a.keys.crouch = true;
  run(room, [a], 60, watch);
  a.keys.crouch = false;
  run(room, [a], 20, watch);

  // 2) Снова к стене — и отскок вовремя, глядя назад: с ускорением
  Object.assign(a.keys, { yaw: EAST, forward: 1 });
  for (let i = 0; i < 240 && s.origin.x < 150; i++) run(room, [a], 1, watch);
  tap();
  for (let i = 0; i < 60 && !s.wallTouch; i++) run(room, [a], 1, watch);
  const hitSpeed = s.wallSpeed;
  Object.assign(a.keys, { yaw: Math.PI / 2, forward: 0 });
  tap();
  const boosted = lengthXZ(s.velocity) > hitSpeed + MOVE.wallJumpBoost - 1;
  run(room, [a], 60, watch);

  const corr = a.session.predictor.largestCorrection;
  check(
    'net parkour',
    late && slid && boosted && corr < 0.001,
    `late walljump=${late} slide=${slid} timed walljump boost=${boosted} max correction=${corr}`,
  );
}

// ─── Второй игрок: появляется у первого там же, где он на сервере; ушёл — пропал ───
{
  const b = connect(room, 'bob');
  run(room, [a, b], 90);
  const bobAtAlice = findPlayer(a.world, b.me.id);
  const gap = bobAtAlice ? Math.sqrt(distSq(bobAtAlice.state.origin, b.server.player.state.origin)) : NaN;
  check('net second player', !!bobAtAlice && !bobAtAlice.dead && gap < 1 && a.session.humans === 2, `gap=${round(gap)} humans=${a.session.humans}`);

  room.leave(b.server);
  run(room, [a], 10);
  check('net leave', !findPlayer(a.world, b.me.id) && a.session.humans === 1, `players=${a.world.players.length}`);
}

// ─── Защита от ускорения: 3 команды за тик двигают не быстрее, чем 1 ───
{
  const c = room.join({ send: () => {} }, 'speedhacker')!;
  spawnPlayer(c.player.state, { feet: vec3(-900, 0, 900), yaw: 0 }); // ровный пол на 1500 юнитов вперёд
  const start = vec3(c.player.state.origin.x, 0, c.player.state.origin.z);
  const w = new Writer();
  const cmd: UserCmd = { ...createUserCmd(), forward: 1, yaw: -Math.PI / 2 }; // бежим в +X
  let seq = 0;
  for (let i = 0; i < 120; i++) {
    for (let k = 0; k < 3; k++) {
      writeCmd(w, ++seq, cmd);
      room.receive(c, w.finish());
    }
    room.tick();
  }
  const dist = Math.sqrt(distSq(start, vec3(c.player.state.origin.x, 0, c.player.state.origin.z)));
  check('net speedhack', dist < 800, `distance in 2s=${round(dist)} (честно ~620)`);

  room.receive(c, new Uint8Array([MSG.CMD, 1, 2])); // обрезанное сообщение
  room.tick();
  check('net garbage', !c.player.dead, 'сервер не упал');
  room.leave(c);
}
