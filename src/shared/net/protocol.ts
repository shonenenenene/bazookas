import { type Vec3, vec3 } from '../math';
import type { UserCmd } from '../player';
import type { GameEvent, Player, World } from '../world';
import type { Reader, Writer } from './binary';

// ─────────────────────────────────────────────────────────────
// Сетевой протокол: какие сообщения ходят между клиентом и сервером и как они упакованы в байты.
//
// Клиент → сервер:  CMD (ввод за один тик, 60 раз/с), PING.
// Сервер → клиент:  WELCOME (ты в игре, вот кто здесь есть), JOIN / LEAVE (кто-то зашёл / вышел),
//                   SNAPSHOT (снимок мира, 30 раз/с), PONG.
//
// Первый байт сообщения — его тип (MSG), дальше поля строго в том порядке, как в write*/read* ниже.
// Поменял порядок в write — поменяй и в read, иначе сервер и клиент перестанут понимать друг друга.
// ─────────────────────────────────────────────────────────────

export const MSG = {
  CMD: 1,
  PING: 2,
  WELCOME: 10,
  JOIN: 11,
  LEAVE: 12,
  SNAPSHOT: 13,
  PONG: 14,
} as const;

const EVENT = { spawn: 1, fire: 2, explode: 3, damage: 4, kill: 5 } as const;

const HALF_PI = Math.PI / 2;

/** Имя комнаты (из адреса ?room=…): латиница, цифры, - и _, до 32 знаков. Пустое — 'main'. */
export function cleanRoomName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'main';
}

// ─── Ввод игрока ────────────────────────────────────────────

/**
 * Углы уходят на сервер как float32 (4 байта вместо 8). Клиент округляет их так же ДО предсказания,
 * иначе его расчёт движения разойдётся с серверным.
 */
export function quantizeCmd(cmd: UserCmd): void {
  cmd.yaw = Math.fround(cmd.yaw);
  cmd.pitch = Math.fround(cmd.pitch);
}

export function writeCmd(w: Writer, seq: number, cmd: UserCmd): void {
  w.u8(MSG.CMD);
  w.u32(seq);
  w.i8(cmd.forward);
  w.i8(cmd.right);
  w.u8((cmd.jump ? 1 : 0) | (cmd.fire ? 2 : 0) | (cmd.crouch ? 4 : 0));
  w.u8(cmd.weapon);
  w.f32(cmd.yaw);
  w.f32(cmd.pitch);
}

/** Прочитать команду (тип уже прочитан). Возвращает её номер. Заодно чинит мусор от читеров и багов. */
export function readCmd(r: Reader, out: UserCmd): number {
  const seq = r.u32();
  out.forward = Math.sign(r.i8());
  out.right = Math.sign(r.i8());
  const buttons = r.u8();
  out.jump = (buttons & 1) !== 0;
  out.fire = (buttons & 2) !== 0;
  out.crouch = (buttons & 4) !== 0;
  out.weapon = r.u8();
  // NaN в углах отравил бы всю физику игрока
  const yaw = r.f32();
  const pitch = r.f32();
  out.yaw = Number.isFinite(yaw) ? yaw : 0;
  out.pitch = Number.isFinite(pitch) ? Math.max(-HALF_PI, Math.min(HALF_PI, pitch)) : 0;
  return seq;
}

export function writePing(w: Writer, time: number): void {
  w.u8(MSG.PING);
  w.f64(time);
}

export function writePong(w: Writer, time: number): void {
  w.u8(MSG.PONG);
  w.f64(time);
}

// ─── Кто в комнате ──────────────────────────────────────────

export interface PlayerInfo {
  id: number;
  name: string;
  bot: boolean;
}

function writePlayerInfo(w: Writer, p: Player): void {
  w.u32(p.id);
  w.str(p.name);
  w.bool(p.bot !== null);
}

export function readPlayerInfo(r: Reader): PlayerInfo {
  return { id: r.u32(), name: r.str(), bot: r.bool() };
}

/** Приветствие новичку: его id и все, кто уже в комнате (включая манекенов). */
export function writeWelcome(w: Writer, world: World, you: Player): void {
  w.u8(MSG.WELCOME);
  w.u32(you.id);
  w.u8(world.players.length);
  for (const p of world.players) writePlayerInfo(w, p);
}

export function writeJoin(w: Writer, p: Player): void {
  w.u8(MSG.JOIN);
  writePlayerInfo(w, p);
}

export function writeLeave(w: Writer, id: number): void {
  w.u8(MSG.LEAVE);
  w.u32(id);
}

// ─── Снимок мира ────────────────────────────────────────────

/**
 * Своё состояние целиком: с него клиент продолжает предсказывать движение.
 * Добавил поле в PlayerState — добавь его и сюда (и в write/readSnapshot, и в applyServerState в prediction.ts).
 */
export interface NetMe {
  origin: Vec3;
  velocity: Vec3;
  onGround: boolean;
  jumpDown: boolean;
  jumpBuffer: number;
  knockbackTime: number;
  groundTicks: number;
  crouched: boolean;
  sliding: boolean;
  slideCooldown: number;
  wallTouch: boolean;
  wallTime: number;
  wallSpeed: number;
  wallJumps: number;
  wallNormal: Vec3;
  wallCooldown: number;
  cooldown: number;
  weapon: number;
  rocketsFired: number;
  health: number;
  dead: boolean;
}

/** Другой игрок — только то, что нужно, чтобы его нарисовать. */
export interface NetPlayer {
  id: number;
  dead: boolean;
  crouched: boolean;
  weapon: number;
  pos: Vec3;
  yaw: number;
  pitch: number;
}

export interface NetRocket {
  id: number;
  ownerId: number;
  weapon: number;
  pos: Vec3;
}

/** Событие мира с номером тика, в который оно случилось. */
export interface TimedEvent {
  tick: number;
  event: GameEvent;
}

export interface Snapshot {
  /** Тик сервера, на котором снят мир */
  tick: number;
  /** Последняя команда этого клиента, которую сервер уже применил */
  ack: number;
  me: NetMe;
  /** Массивы переиспользуются и бывают длиннее, чем нужно, — читать только первые playerCount / rocketCount */
  players: NetPlayer[];
  playerCount: number;
  rockets: NetRocket[];
  rocketCount: number;
  /** События с прошлого снимка */
  events: TimedEvent[];
}

export function createSnapshot(): Snapshot {
  return {
    tick: 0,
    ack: 0,
    me: {
      origin: vec3(), velocity: vec3(), onGround: false, jumpDown: false, jumpBuffer: 0, knockbackTime: 0, groundTicks: 0,
      crouched: false, sliding: false, slideCooldown: 0,
      wallTouch: false, wallTime: 0, wallSpeed: 0, wallJumps: 0, wallNormal: vec3(), wallCooldown: 0,
      cooldown: 0, weapon: 0, rocketsFired: 0, health: 0, dead: false,
    },
    players: [],
    playerCount: 0,
    rockets: [],
    rocketCount: 0,
    events: [],
  };
}

export function writeSnapshot(w: Writer, world: World, me: Player, ack: number, events: readonly TimedEvent[]): void {
  w.u8(MSG.SNAPSHOT);
  w.u32(world.tick);
  w.u32(ack);

  // Свой игрок — полностью и в float64: клиент продолжит считать с этого места, числа должны совпасть до бита
  const s = me.state;
  w.f64(s.origin.x);
  w.f64(s.origin.y);
  w.f64(s.origin.z);
  w.f64(s.velocity.x);
  w.f64(s.velocity.y);
  w.f64(s.velocity.z);
  w.f64(s.knockbackTime);
  w.f64(s.slideCooldown);
  w.f64(s.wallTime);
  w.f64(s.wallSpeed);
  w.f64(s.wallNormal.x);
  w.f64(s.wallNormal.y);
  w.f64(s.wallNormal.z);
  w.f64(s.wallCooldown);
  w.f64(me.cooldown);
  w.u8(
    (s.onGround ? 1 : 0) | (s.jumpDown ? 2 : 0) | (me.dead ? 4 : 0) |
    (s.crouched ? 8 : 0) | (s.sliding ? 16 : 0) | (s.wallTouch ? 32 : 0),
  );
  w.u8(s.groundTicks);
  w.u8(s.wallJumps);
  w.u8(s.jumpBuffer);
  w.u8(me.weapon);
  w.u32(me.rocketsFired);
  w.f32(me.health);

  // Все игроки (и мы тоже — для порядка) — коротко, их только рисуют
  w.u8(world.players.length);
  for (const p of world.players) {
    w.u32(p.id);
    w.u8((p.dead ? 1 : 0) | (p.state.crouched ? 2 : 0));
    w.u8(p.weapon);
    writeVec(w, p.state.origin);
    w.f32(p.cmd.yaw);
    w.f32(p.cmd.pitch);
  }

  w.u16(world.rockets.length);
  for (const r of world.rockets) {
    w.u32(r.id);
    w.u32(r.ownerId);
    w.u8(r.weapon);
    writeVec(w, r.pos);
  }

  w.u16(events.length);
  for (const e of events) {
    w.u32(e.tick);
    writeEvent(w, e.event);
  }
}

/** Прочитать снимок (тип уже прочитан) в готовый объект `out` — без лишнего мусора в памяти. */
export function readSnapshot(r: Reader, out: Snapshot): void {
  out.tick = r.u32();
  out.ack = r.u32();

  const me = out.me;
  me.origin.x = r.f64();
  me.origin.y = r.f64();
  me.origin.z = r.f64();
  me.velocity.x = r.f64();
  me.velocity.y = r.f64();
  me.velocity.z = r.f64();
  me.knockbackTime = r.f64();
  me.slideCooldown = r.f64();
  me.wallTime = r.f64();
  me.wallSpeed = r.f64();
  me.wallNormal.x = r.f64();
  me.wallNormal.y = r.f64();
  me.wallNormal.z = r.f64();
  me.wallCooldown = r.f64();
  me.cooldown = r.f64();
  const flags = r.u8();
  me.onGround = (flags & 1) !== 0;
  me.jumpDown = (flags & 2) !== 0;
  me.dead = (flags & 4) !== 0;
  me.crouched = (flags & 8) !== 0;
  me.sliding = (flags & 16) !== 0;
  me.wallTouch = (flags & 32) !== 0;
  me.groundTicks = r.u8();
  me.wallJumps = r.u8();
  me.jumpBuffer = r.u8();
  me.weapon = r.u8();
  me.rocketsFired = r.u32();
  me.health = r.f32();

  out.playerCount = r.u8();
  for (let i = 0; i < out.playerCount; i++) {
    const p = (out.players[i] ??= { id: 0, dead: false, crouched: false, weapon: 0, pos: vec3(), yaw: 0, pitch: 0 });
    p.id = r.u32();
    const pflags = r.u8();
    p.dead = (pflags & 1) !== 0;
    p.crouched = (pflags & 2) !== 0;
    p.weapon = r.u8();
    readVec(r, p.pos);
    p.yaw = r.f32();
    p.pitch = r.f32();
  }

  out.rocketCount = r.u16();
  for (let i = 0; i < out.rocketCount; i++) {
    const rk = (out.rockets[i] ??= { id: 0, ownerId: 0, weapon: 0, pos: vec3() });
    rk.id = r.u32();
    rk.ownerId = r.u32();
    rk.weapon = r.u8();
    readVec(r, rk.pos);
  }

  out.events.length = 0;
  const eventCount = r.u16();
  for (let i = 0; i < eventCount; i++) {
    const tick = r.u32();
    out.events.push({ tick, event: readEvent(r) });
  }
}

// ─── События ────────────────────────────────────────────────

function writeEvent(w: Writer, e: GameEvent): void {
  switch (e.type) {
    case 'spawn':
      w.u8(EVENT.spawn);
      w.u32(e.playerId);
      w.f32(e.yaw);
      break;
    case 'fire':
      w.u8(EVENT.fire);
      w.u32(e.playerId);
      w.u8(e.weapon);
      break;
    case 'explode':
      w.u8(EVENT.explode);
      writeVec(w, e.pos);
      w.u8(e.weapon);
      w.u32(e.ownerId);
      w.u32(e.serial);
      break;
    case 'damage':
      w.u8(EVENT.damage);
      w.u32(e.targetId);
      w.i32(e.attackerId);
      w.f32(e.amount);
      break;
    case 'kill':
      w.u8(EVENT.kill);
      w.u32(e.targetId);
      w.i32(e.attackerId);
      w.i8(e.weapon);
      writeVec(w, e.pos);
      break;
  }
}

function readEvent(r: Reader): GameEvent {
  const type = r.u8();
  switch (type) {
    case EVENT.spawn:
      return { type: 'spawn', playerId: r.u32(), yaw: r.f32() };
    case EVENT.fire:
      return { type: 'fire', playerId: r.u32(), weapon: r.u8() };
    case EVENT.explode:
      return { type: 'explode', pos: readVec(r, vec3()), weapon: r.u8(), ownerId: r.u32(), serial: r.u32() };
    case EVENT.damage:
      return { type: 'damage', targetId: r.u32(), attackerId: r.i32(), amount: r.f32() };
    case EVENT.kill:
      return { type: 'kill', targetId: r.u32(), attackerId: r.i32(), weapon: r.i8(), pos: readVec(r, vec3()) };
    default:
      throw new Error(`Неизвестное событие ${type}`);
  }
}

function writeVec(w: Writer, v: Vec3): void {
  w.f32(v.x);
  w.f32(v.y);
  w.f32(v.z);
}

function readVec(r: Reader, out: Vec3): Vec3 {
  out.x = r.f32();
  out.y = r.f32();
  out.z = r.f32();
  return out;
}
