import { MOVE } from '../config';
import { type Vec3, normalize, vec3 } from '../math';
import type { Trigger } from './types';

// Сборка зон карты: джамп-пады и бустеры. Для карт из TrenchBroom это будут trigger_push и т.п.

/** Джамп-пад в коробке min..max (низ коробки — поверхность пада): прыжок с него — на height вверх. */
export function jumpPad(min: Vec3, max: Vec3, height: number): Trigger {
  // Подбросить на высоту h: v = √(2·g·h)
  return { type: 'jumppad', min, max, height, jumpVelocity: Math.sqrt(2 * MOVE.gravity * height) };
}

/** Бустер в коробке min..max: разгоняет в сторону (dirX, dirZ) до speed, прибавляя accel u/s за секунду. */
export function booster(min: Vec3, max: Vec3, dirX: number, dirZ: number, speed: number, accel: number): Trigger {
  const dir = vec3(dirX, 0, dirZ);
  normalize(dir, dir);
  return { type: 'booster', min, max, dir, speed, accel };
}
