import { type BotBehavior, updateBotCmd } from './bots';
import { detonateRemote, fireWeapon, killPlayer, updateRockets } from './combat';
import { COMBAT } from './config';
import type { GameMap, SpawnPoint } from './maps/types';
import { type Vec3, copy, distSqXZ, vec3 } from './math';
import { playerMove } from './movement';
import { type PlayerState, type UserCmd, createPlayerState, createUserCmd, playerHalf, spawnPlayer } from './player';
import { WEAPON_COUNT, WEAPONS } from './weapons';

// ─────────────────────────────────────────────────────────────
// Мир: все игроки, ракеты и правила одного тика.
// Без графики: клиент только рисует мир, а сервер его считает.
// ─────────────────────────────────────────────────────────────

/** Игрок или манекен. */
export interface Player {
  id: number;
  name: string;
  state: PlayerState;
  /** Позиция на прошлом тике — чтобы рисовать плавно между тиками */
  prevOrigin: Vec3;
  /** На сколько резко подняло (+) / опустило (−) в последнем тике (ступенька, присед) — по нему клиент сглаживает камеру */
  lastStep: number;
  /** Что игрок «нажал» в этом тике (живой — с клавиатуры или по сети, манекен — из bots.ts) */
  cmd: UserCmd;
  health: number;
  /** Текущая базука (индекс в WEAPONS) */
  weapon: number;
  /** Секунд до следующего выстрела */
  cooldown: number;
  /** Сколько ракет выпустил за всё время — отсюда порядковые номера ракет (Rocket.serial) */
  rocketsFired: number;
  /** Текущий разброс от частой стрельбы, градусы (WeaponDef.bloom*) */
  bloom: number;
  /** «Огонь» был зажат в прошлом тике — так ловим именно нажатие (подрыв по кнопке) */
  fireDown: boolean;
  /** Номер своего снаряда, который ждёт подрыва по кнопке (WeaponDef.remote); −1 — такого нет */
  remoteSerial: number;
  /** Счёт матча: фраги (убил другого игрока +1, сам себя или бездна −1) и смерти. Считает сервер (server/match.ts) */
  frags: number;
  deaths: number;
  dead: boolean;
  respawnTimer: number;
  /** Своя точка появления (манекены, игрок в песочнице); null — каждый раз выбирать самую свободную */
  spawn: SpawnPoint | null;
  /** Последний пройденный чекпоинт (зона на карте) — появляемся на нём; null — не было или пересекли финиш */
  checkpoint: SpawnPoint | null;
  /** Поведение манекена; null — живой игрок */
  bot: BotBehavior | null;
  /** Команды приходят по сети: сервер сам вызывает playerThink, когда они приходят, а worldTick его не двигает */
  netControlled: boolean;
}

export interface Rocket {
  id: number;
  ownerId: number;
  /** Порядковый номер ракеты у хозяина (0, 1, 2…) — по нему клиент узнаёт свою ракету в событиях сервера */
  serial: number;
  weapon: number;
  pos: Vec3;
  /** Позиция на прошлом тике — для плавной отрисовки */
  prevPos: Vec3;
  vel: Vec3;
  /** Сколько секунд летит */
  age: number;
  /** Сколько ещё отскоков от стен осталось (Bouncy Castle); 0 — взорвётся при касании */
  bounces: number;
}

/**
 * События мира: по ним клиент рисует эффекты, обновляет HUD и (позже) играет звуки.
 * Копятся в world.events, пока их не заберёт клиент (или сервер, чтобы разослать игрокам).
 */
export type GameEvent =
  /** yaw — куда смотрит появившийся (клиент разворачивает по нему камеру) */
  | { type: 'spawn'; playerId: number; yaw: number }
  | { type: 'fire'; playerId: number; weapon: number }
  /**
   * dir — куда летел снаряд (длина 1; по нему клиент втыкает нож в стену); hitPlayer — попал в игрока;
   * expired — кончилось время полёта (взорвался в воздухе)
   */
  | { type: 'explode'; pos: Vec3; weapon: number; ownerId: number; serial: number; dir: Vec3; hitPlayer: boolean; expired: boolean }
  /** headshot — прямое попадание в голову */
  | { type: 'damage'; targetId: number; attackerId: number; amount: number; headshot: boolean }
  /** attackerId = −1 — убила бездна; weapon = −1 — не базукой */
  | { type: 'kill'; targetId: number; attackerId: number; weapon: number; pos: Vec3; headshot: boolean };

export interface World {
  map: GameMap;
  players: Player[];
  rockets: Rocket[];
  /**
   * Только у клиента в сети: свои ракеты, запущенные сразу, не дожидаясь сервера (см. fireWeapon).
   * Они рисуются и толкают нас при рокет-джампе, но урона не наносят. У сервера и в песочнице — пусто.
   */
  predictedRockets: Rocket[];
  events: GameEvent[];
  tick: number;
  /** Счётчик для id игроков и ракет */
  nextId: number;
  /**
   * true — этот мир сам решает, кто куда попал (сервер и одиночная песочница).
   * false — клиент в сетевой игре: только предсказывает своё движение, а ракеты, урон и смерти приходят с сервера.
   */
  authority: boolean;
}

export interface WorldOptions {
  /** Поставить манекенов с карты (по умолчанию да) */
  dummies?: boolean;
  /** См. World.authority (по умолчанию true) */
  authority?: boolean;
}

/** Ниже этой высоты — «упал в бездну» */
const VOID_Y = -1000;

/** Создать мир по карте (вместе с манекенами, которые на ней стоят). */
export function createWorld(map: GameMap, options: WorldOptions = {}): World {
  const world: World = {
    map, players: [], rockets: [], predictedRockets: [], events: [], tick: 0, nextId: 1,
    authority: options.authority ?? true,
  };
  if (options.dummies ?? true) for (const d of map.dummies) addPlayer(world, d.name, d.spawn, d.bot);
  return world;
}

/** Добавить игрока. id задаёт только клиент в сети — там номера раздаёт сервер. */
export function addPlayer(
  world: World,
  name: string,
  spawn: SpawnPoint | null,
  bot: BotBehavior | null = null,
  id = world.nextId++,
): Player {
  const p: Player = {
    id,
    name,
    state: createPlayerState(),
    prevOrigin: vec3(),
    lastStep: 0,
    cmd: createUserCmd(),
    health: COMBAT.maxHealth,
    weapon: 0,
    cooldown: 0,
    rocketsFired: 0,
    bloom: 0,
    fireDown: false,
    remoteSerial: -1,
    frags: 0,
    deaths: 0,
    dead: false,
    respawnTimer: 0,
    spawn,
    checkpoint: null,
    bot,
    netControlled: false,
  };
  world.players.push(p);
  respawnPlayer(world, p);
  return p;
}

export function removePlayer(world: World, id: number): void {
  const i = world.players.findIndex((p) => p.id === id);
  if (i >= 0) world.players.splice(i, 1);
}

/** Вернуть игрока на точку появления с полным здоровьем. */
export function respawnPlayer(world: World, p: Player): void {
  const spawn = p.checkpoint ?? p.spawn ?? pickSpawn(world, p);
  spawnPlayer(p.state, spawn);
  copy(p.prevOrigin, p.state.origin); // чтобы не было «пролёта» от места смерти
  p.cmd.yaw = spawn.yaw;
  p.cmd.pitch = 0;
  p.health = COMBAT.maxHealth;
  p.dead = false;
  p.cooldown = 0;
  p.bloom = 0;
  world.events.push({ type: 'spawn', playerId: p.id, yaw: spawn.yaw });
}

/** Точка появления подальше от всех живых (как в Quake) — чтобы не появляться под чужой базукой. */
function pickSpawn(world: World, p: Player): SpawnPoint {
  let best = world.map.spawns[0];
  let bestDist = -1;
  for (const s of world.map.spawns) {
    let nearest = Infinity;
    for (const o of world.players) {
      if (o !== p && !o.dead) nearest = Math.min(nearest, distSqXZ(s.feet, o.state.origin));
    }
    if (nearest > bestDist) {
      bestDist = nearest;
      best = s;
    }
  }
  return best;
}

export function findPlayer(world: World, id: number): Player | undefined {
  for (const p of world.players) if (p.id === id) return p;
  return undefined;
}

/**
 * Один тик игрока по его команде p.cmd: смена базуки, движение, перезарядка, выстрел.
 * В одиночной игре его зовёт worldTick, на сервере — приход команды по сети,
 * на клиенте в сети — предсказание своего движения.
 */
export function playerThink(world: World, p: Player, dt: number): void {
  p.lastStep = 0;
  if (p.dead) return;

  // Смена базуки мгновенная: перезарядка общая, поэтому сменой её не обмануть
  if (p.cmd.weapon >= 0 && p.cmd.weapon < WEAPON_COUNT) p.weapon = p.cmd.weapon; // осколки (скрытые) не выбрать

  p.lastStep = playerMove(p.state, p.cmd, world.map.brushes, dt, world.map.triggers);

  p.cooldown = Math.max(0, p.cooldown - dt);
  // Разброс от частой стрельбы уходит, только когда базука уже готова к выстрелу, а ты не стреляешь
  // (пока жмёшь без пауз — копится, как в CS)
  if (p.cooldown === 0) p.bloom = Math.max(0, p.bloom - (WEAPONS[p.weapon].bloomRecovery ?? 10) * dt);
  // Огонь. У базуки с подрывом по кнопке: снаряд летит — нажатие его взрывает; нет снаряда — выстрел (тоже на нажатие)
  const w = WEAPONS[p.weapon];
  const pressed = p.cmd.fire && !p.fireDown;
  p.fireDown = p.cmd.fire;
  if (w.remote && p.remoteSerial >= 0) {
    if (pressed) detonateRemote(world, p);
  } else if (p.cmd.fire && p.cooldown === 0 && (!w.remote || pressed)) fireWeapon(world, p);

  if (world.authority) worldTriggers(world, p);
}

/** Зоны, которые решает мир, а не движение: чекпоинты и пустота (и бездна ниже VOID_Y). */
function worldTriggers(world: World, p: Player): void {
  const o = p.state.origin;
  const h = playerHalf(p.state);
  for (const t of world.map.triggers) {
    if (t.type !== 'checkpoint' && t.type !== 'void') continue;
    const inside = o.x + h.x > t.min.x && o.x - h.x < t.max.x && o.y + h.y > t.min.y && o.y - h.y < t.max.y &&
      o.z + h.z > t.min.z && o.z - h.z < t.max.z;
    if (!inside) continue;
    if (t.type === 'checkpoint') p.checkpoint = t.reset ? null : t.spawn;
    else return fell(world, p);
  }
  if (o.y < VOID_Y) fell(world, p);
}

/**
 * Упал в пустоту. На трассе с чекпоинтами (серф) живой игрок сразу появляется на последнем пройденном — без смерти,
 * чтобы тренироваться без ожидания. Манекены и игроки на обычных картах гибнут.
 */
function fell(world: World, p: Player): void {
  if (!p.bot && world.map.triggers.some((t) => t.type === 'checkpoint')) respawnPlayer(world, p);
  else killPlayer(world, p, -1, -1);
}

/** Один тик мира: игроки (кроме сетевых — их двигают команды), манекены, ракеты, респауны. */
export function worldTick(world: World, dt: number): void {
  const time = world.tick * dt;

  for (const p of world.players) {
    copy(p.prevOrigin, p.state.origin);

    if (p.dead) {
      p.lastStep = 0;
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) respawnPlayer(world, p);
      continue;
    }
    if (p.netControlled) continue;

    if (p.bot) updateBotCmd(p, time);
    playerThink(world, p, dt);
  }

  updateRockets(world, dt);
  world.tick++;
}
