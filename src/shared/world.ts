import { type BotBehavior, updateBotCmd } from './bots';
import { fireWeapon, killPlayer, updateRockets } from './combat';
import { COMBAT } from './config';
import type { GameMap, SpawnPoint } from './maps/types';
import { type Vec3, copy, vec3 } from './math';
import { playerMove } from './movement';
import { type PlayerState, type UserCmd, createPlayerState, createUserCmd, spawnPlayer } from './player';
import { WEAPONS } from './weapons';

// ─────────────────────────────────────────────────────────────
// Мир: все игроки, ракеты и правила одного тика.
// Без графики: клиент только рисует мир, а позже сервер будет его считать.
// ─────────────────────────────────────────────────────────────

/** Игрок или манекен. */
export interface Player {
  id: number;
  name: string;
  state: PlayerState;
  /** Позиция на прошлом тике — чтобы рисовать плавно между тиками */
  prevOrigin: Vec3;
  /** Что игрок «нажал» в этом тике (живой — с клавиатуры, манекен — из bots.ts) */
  cmd: UserCmd;
  health: number;
  /** Текущая базука (индекс в WEAPONS) */
  weapon: number;
  /** Секунд до следующего выстрела */
  cooldown: number;
  dead: boolean;
  respawnTimer: number;
  spawn: SpawnPoint;
  /** Поведение манекена; null — живой игрок */
  bot: BotBehavior | null;
}

export interface Rocket {
  id: number;
  ownerId: number;
  weapon: number;
  pos: Vec3;
  /** Позиция на прошлом тике — для плавной отрисовки */
  prevPos: Vec3;
  vel: Vec3;
  /** Сколько секунд летит */
  age: number;
}

/**
 * События мира: по ним клиент рисует эффекты, обновляет HUD и (позже) играет звуки.
 * Копятся в world.events, пока их не заберёт клиент.
 */
export type GameEvent =
  | { type: 'spawn'; playerId: number }
  | { type: 'fire'; playerId: number; weapon: number }
  | { type: 'explode'; pos: Vec3; weapon: number }
  | { type: 'damage'; targetId: number; attackerId: number; amount: number }
  /** attackerId = −1 — убила бездна; weapon = −1 — не базукой */
  | { type: 'kill'; targetId: number; attackerId: number; weapon: number; pos: Vec3 };

export interface World {
  map: GameMap;
  players: Player[];
  rockets: Rocket[];
  events: GameEvent[];
  tick: number;
  /** Счётчик для id игроков и ракет */
  nextId: number;
}

/** Ниже этой высоты — «упал в бездну» */
const VOID_Y = -1000;

/** Создать мир по карте (вместе с манекенами, которые на ней стоят). */
export function createWorld(map: GameMap): World {
  const world: World = { map, players: [], rockets: [], events: [], tick: 0, nextId: 1 };
  for (const d of map.dummies) addPlayer(world, d.name, d.spawn, d.bot);
  return world;
}

export function addPlayer(world: World, name: string, spawn: SpawnPoint, bot: BotBehavior | null = null): Player {
  const p: Player = {
    id: world.nextId++,
    name,
    state: createPlayerState(),
    prevOrigin: vec3(),
    cmd: createUserCmd(),
    health: COMBAT.maxHealth,
    weapon: 0,
    cooldown: 0,
    dead: false,
    respawnTimer: 0,
    spawn,
    bot,
  };
  world.players.push(p);
  respawnPlayer(world, p);
  return p;
}

/** Вернуть игрока на его точку появления с полным здоровьем. */
export function respawnPlayer(world: World, p: Player): void {
  spawnPlayer(p.state, p.spawn);
  copy(p.prevOrigin, p.state.origin); // чтобы не было «пролёта» от места смерти
  p.cmd.yaw = p.spawn.yaw;
  p.cmd.pitch = 0;
  p.health = COMBAT.maxHealth;
  p.dead = false;
  p.cooldown = 0;
  world.events.push({ type: 'spawn', playerId: p.id });
}

export function findPlayer(world: World, id: number): Player | undefined {
  for (const p of world.players) if (p.id === id) return p;
  return undefined;
}

/** Один тик мира: движение всех игроков, выстрелы, полёт ракет. */
export function worldTick(world: World, dt: number): void {
  const time = world.tick * dt;

  for (const p of world.players) {
    copy(p.prevOrigin, p.state.origin);

    if (p.dead) {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) respawnPlayer(world, p);
      continue;
    }

    if (p.bot) updateBotCmd(p, time);

    // Смена базуки мгновенная: перезарядка общая, поэтому сменой её не обмануть
    if (p.cmd.weapon >= 0 && p.cmd.weapon < WEAPONS.length) p.weapon = p.cmd.weapon;

    playerMove(p.state, p.cmd, world.map.brushes, dt);

    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.cmd.fire && p.cooldown === 0) fireWeapon(world, p);

    if (p.state.origin.y < VOID_Y) killPlayer(world, p, -1, -1);
  }

  updateRockets(world, dt);
  world.tick++;
}
