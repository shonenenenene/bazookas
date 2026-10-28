import type { BotBehavior } from '../bots';
import type { Brush } from '../collision/brush';
import type { Vec3 } from '../math';

export interface SpawnPoint {
  /** Точка на полу, где стоят ноги */
  feet: Vec3;
  /** Куда смотрим при появлении, радианы */
  yaw: number;
}

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
  /** Цвет неба и тумана, 0xRRGGBB */
  skyColor: number;
  /** Туман начинается на этом расстоянии… */
  fogNear: number;
  /** …и полностью закрывает всё здесь. Дальше этого ничего не рисуется (экономия). */
  fogFar: number;
}
