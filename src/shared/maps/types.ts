import type { BotBehavior } from '../bots';
import type { Brush } from '../collision/brush';
import type { Vec3 } from '../math';

export interface SpawnPoint {
  /** Точка на полу, где стоят ноги */
  feet: Vec3;
  /** Куда смотрим при появлении, радианы */
  yaw: number;
  /** Скорость сразу после появления — вперёд, куда смотришь (чекпоинты серф-трассы: появляешься уже в движении) */
  speed?: number;
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
  | { type: 'booster'; min: Vec3; max: Vec3; dir: Vec3; speed: number; accel: number }
  /**
   * Чекпоинт: пролетел через зону — упав в пустоту (или погибнув), появишься в spawn
   * (в TrenchBroom — info_checkpoint, на который указывает target зоны; без него — низ середины зоны).
   * reset — наоборот, «финиш»: забывает чекпоинт, дальше снова со старта
   */
  | { type: 'checkpoint'; min: Vec3; max: Vec3; spawn: SpawnPoint; reset: boolean }
  /**
   * Пустота (пропасть): попал — на карте с чекпоинтами сразу появляешься на последнем (манекены — гибнут),
   * без чекпоинтов — гибнешь. Ниже y = −1000 пустота везде, и без зон
   */
  | { type: 'void'; min: Vec3; max: Vec3 };

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
  /** Небо: не задано — просто цвет skyColor; space — космос: звёзды, туманности, кровавая луна (render/sky.ts) */
  sky?: 'space';
  /** Пара строк о карте — в меню, под картинкой */
  description?: string;
  /**
   * Тренировочная карта (серф и т.п.): в онлайне на ней остаются манекены, а в смену карт после матча она не попадает.
   * На обычных картах в онлайне манекенов нет — только люди
   */
  training?: boolean;
  /** Откуда снимать картинку-превью для меню (npm run previews): глаза камеры, yaw и pitch в радианах */
  preview?: { eye: Vec3; yaw: number; pitch: number };
  /** Туман начинается на этом расстоянии… */
  fogNear: number;
  /** …и полностью закрывает всё здесь. Дальше этого ничего не рисуется (экономия). */
  fogFar: number;
}
