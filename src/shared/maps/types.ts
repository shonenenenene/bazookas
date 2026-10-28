import type { BotBehavior } from '../bots';
import type { Brush } from '../collision/brush';
import type { Vec3 } from '../math';

export interface SpawnPoint {
  /** Точка на полу, где стоят ноги */
  feet: Vec3;
  /** Куда смотрим при появлении, радианы */
  yaw: number;
}

/**
 * Невидимая зона на карте: что-то делает с игроком, пока его коробка её касается.
 * Видимую часть (светящуюся плиту на полу) рисуем обычным брашем. Собирать удобно через triggers.ts.
 */
export type Trigger =
  /**
   * Джамп-пад: прыжок, стоя на нём, — высокий (на height вверх). Горизонтальная скорость сохраняется:
   * летишь туда, куда бежал. Без прыжка — обычный пол
   */
  | { type: 'jumppad'; min: Vec3; max: Vec3; height: number; /** Скорость вверх — считается из height */ jumpVelocity: number }
  /** Бустер: пока стоишь в зоне, разгоняет в сторону dir (горизонталь, длина 1) до скорости speed */
  | { type: 'booster'; min: Vec3; max: Vec3; dir: Vec3; speed: number; accel: number };

/** Манекен для тренировки, который стоит на карте. */
export interface DummySpawn {
  name: string;
  spawn: SpawnPoint;
  bot: BotBehavior;
}

export interface GameMap {
  name: string;
  brushes: Brush[];
  spawns: SpawnPoint[];
  dummies: DummySpawn[];
  triggers: Trigger[];
  /** Цвет неба и тумана, 0xRRGGBB */
  skyColor: number;
  /** Туман начинается на этом расстоянии… */
  fogNear: number;
  /** …и полностью закрывает всё здесь. Дальше этого ничего не рисуется (экономия). */
  fogFar: number;
}
