import { PLAYER } from './config';
import { type Vec3, copy, set, vec3 } from './math';
import type { SpawnPoint } from './maps/types';

/** Всё о движении игрока. Позже сервер будет рассылать это клиентам. */
export interface PlayerState {
  /** Центр коробки игрока */
  origin: Vec3;
  /** Скорость, u/s */
  velocity: Vec3;
  onGround: boolean;
  /** Нормаль пола под ногами (нужна, чтобы бегать по рампам) */
  groundNormal: Vec3;
  /** Пробел всё ещё зажат с прошлого прыжка (важно, когда autoHop выключен) */
  jumpHeld: boolean;
  /** Сколько ещё секунд после взрыва трение не действует (чтобы отбрасывание не гасло об пол) */
  knockbackTime: number;
}

/** Что игрок хочет сделать за один тик. Позже клиент будет отправлять это на сервер. */
export interface UserCmd {
  /** -1 назад … 1 вперёд */
  forward: number;
  /** -1 влево … 1 вправо */
  right: number;
  jump: boolean;
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
    jumpHeld: false,
    knockbackTime: 0,
  };
}

export function copyPlayerState(out: PlayerState, src: PlayerState): void {
  copy(out.origin, src.origin);
  copy(out.velocity, src.velocity);
  out.onGround = src.onGround;
  copy(out.groundNormal, src.groundNormal);
  out.jumpHeld = src.jumpHeld;
  out.knockbackTime = src.knockbackTime;
}

export function createUserCmd(): UserCmd {
  return { forward: 0, right: 0, jump: false, yaw: 0, pitch: 0, fire: false, weapon: 0 };
}

/** Поставить игрока на точку появления (стоя на полу, без скорости). */
export function spawnPlayer(ps: PlayerState, spawn: SpawnPoint): void {
  set(ps.origin, spawn.feet.x, spawn.feet.y + PLAYER.halfExtents.y + 1, spawn.feet.z);
  set(ps.velocity, 0, 0, 0);
  ps.onGround = false;
  ps.jumpHeld = false;
  ps.knockbackTime = 0;
}
