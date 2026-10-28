import { PLAYER } from './config';
import { type Vec3, copy, set, vec3 } from './math';
import type { SpawnPoint } from './maps/types';

/**
 * Всё о движении игрока. Сервер присылает это клиенту (protocol.ts → NetMe), и клиент продолжает считать
 * с этого места. Поэтому всё, что движение помнит между тиками, должно быть здесь — и только здесь.
 */
export interface PlayerState {
  /** Центр коробки игрока */
  origin: Vec3;
  /** Скорость, u/s */
  velocity: Vec3;
  onGround: boolean;
  /** Нормаль пола под ногами (нужна, чтобы бегать по рампам) */
  groundNormal: Vec3;
  /** Пробел был зажат в прошлом тике — так ловим момент нажатия (прыгаем на нажатие, а не на удержание) */
  jumpDown: boolean;
  /** Нажал пробел в воздухе — нажатие помнится ещё столько тиков (MOVE.hopEarly), пока держишь */
  jumpBuffer: number;
  /** Сколько ещё секунд после взрыва трение не действует (чтобы отбрасывание не гасло об пол) */
  knockbackTime: number;
  /** Сколько тиков подряд стоим на земле (0 — в воздухе). По нему узнаём удачный банни-хоп */
  groundTicks: number;
  /** Присел (коробка ниже, см. PLAYER.crouchHalfExtents) */
  crouched: boolean;
  /** Едем подкатом */
  sliding: boolean;
  /** Секунд до следующего рывка подкатом */
  slideCooldown: number;
  /** Касаемся стены в полёте (врезались в неё) — можно отпрыгнуть */
  wallTouch: boolean;
  /** Сколько секунд прошло с касания стены (успел в wallJumpWindow — отскок с ускорением) */
  wallTime: number;
  /** С какой скоростью (по горизонтали) врезались в стену — от неё считается ускорение отскока */
  wallSpeed: number;
  /** Сколько отскоков от стен уже было в этом полёте (обнуляется на земле) */
  wallJumps: number;
  /** Нормаль стены, которой касаемся (смотрит от стены к нам) */
  wallNormal: Vec3;
  /** Секунд, пока стена не ловит (после отскока) */
  wallCooldown: number;
}

/** Что игрок хочет сделать за один тик. Клиент отправляет это на сервер. */
export interface UserCmd {
  /** -1 назад … 1 вперёд */
  forward: number;
  /** -1 влево … 1 вправо */
  right: number;
  jump: boolean;
  /** Присесть (Shift или C). На бегу — подкат */
  crouch: boolean;
  /** Поворот по горизонтали, радианы. 0 = смотрим в −Z, растёт при повороте влево */
  yaw: number;
  /** Наклон взгляда, радианы. Плюс = вверх */
  pitch: number;
  /** Зажата кнопка выстрела */
  fire: boolean;
  /** Какую базуку держим (индекс в WEAPONS) */
  weapon: number;
}

export function createPlayerState(): PlayerState {
  return {
    origin: vec3(),
    velocity: vec3(),
    onGround: false,
    groundNormal: vec3(0, 1, 0),
    jumpDown: false,
    jumpBuffer: 0,
    knockbackTime: 0,
    groundTicks: 0,
    crouched: false,
    sliding: false,
    slideCooldown: 0,
    wallTouch: false,
    wallTime: 0,
    wallSpeed: 0,
    wallJumps: 0,
    wallNormal: vec3(),
    wallCooldown: 0,
  };
}

export function copyPlayerState(out: PlayerState, src: PlayerState): void {
  copy(out.origin, src.origin);
  copy(out.velocity, src.velocity);
  out.onGround = src.onGround;
  copy(out.groundNormal, src.groundNormal);
  out.jumpDown = src.jumpDown;
  out.jumpBuffer = src.jumpBuffer;
  out.knockbackTime = src.knockbackTime;
  out.groundTicks = src.groundTicks;
  out.crouched = src.crouched;
  out.sliding = src.sliding;
  out.slideCooldown = src.slideCooldown;
  out.wallTouch = src.wallTouch;
  out.wallTime = src.wallTime;
  out.wallSpeed = src.wallSpeed;
  out.wallJumps = src.wallJumps;
  copy(out.wallNormal, src.wallNormal);
  out.wallCooldown = src.wallCooldown;
}

export function createUserCmd(): UserCmd {
  return { forward: 0, right: 0, jump: false, crouch: false, yaw: 0, pitch: 0, fire: false, weapon: 0 };
}

export function copyUserCmd(out: UserCmd, src: UserCmd): void {
  out.forward = src.forward;
  out.right = src.right;
  out.jump = src.jump;
  out.crouch = src.crouch;
  out.yaw = src.yaw;
  out.pitch = src.pitch;
  out.fire = src.fire;
  out.weapon = src.weapon;
}

/** Половины размеров коробки игрока сейчас: стоя или присев. */
export function playerHalf(ps: PlayerState): Vec3 {
  return ps.crouched ? PLAYER.crouchHalfExtents : PLAYER.halfExtents;
}

/** На сколько глаза выше центра коробки (присевший смотрит ниже). */
export function eyeHeight(ps: PlayerState): number {
  return ps.crouched ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
}

/** Поставить игрока на точку появления (стоя на полу, без скорости). */
export function spawnPlayer(ps: PlayerState, spawn: SpawnPoint): void {
  set(ps.origin, spawn.feet.x, spawn.feet.y + PLAYER.halfExtents.y + 1, spawn.feet.z);
  set(ps.velocity, 0, 0, 0);
  ps.onGround = false;
  ps.jumpDown = false;
  ps.jumpBuffer = 0;
  ps.knockbackTime = 0;
  ps.groundTicks = 0;
  ps.crouched = false;
  ps.sliding = false;
  ps.slideCooldown = 0;
  ps.wallTouch = false;
  ps.wallTime = 0;
  ps.wallSpeed = 0;
  ps.wallJumps = 0;
  ps.wallCooldown = 0;
}
