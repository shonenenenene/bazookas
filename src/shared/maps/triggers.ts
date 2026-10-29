import { MOVE } from '../config';
import { type Vec3, normalize, vec3 } from '../math';
import type { SpawnPoint, Trigger } from './types';

// Сборка зон карты: джамп-пады, бустеры, чекпоинты, пустота. В TrenchBroom это trigger_jumppad, trigger_booster,
// trigger_checkpoint, trigger_void (см. mapFormat.ts).

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

/**
 * Чекпоинт в коробке min..max. spawn — где появишься (не задан — низ середины зоны, лицом в yaw).
 * reset — «финиш»: забыть чекпоинт.
 */
export function checkpoint(min: Vec3, max: Vec3, yaw: number, reset = false, spawn?: SpawnPoint): Trigger {
  const at: SpawnPoint = spawn ?? { feet: vec3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2), yaw };
  return { type: 'checkpoint', min, max, spawn: at, reset };
}

/** Пустота (пропасть) в коробке min..max. */
export function voidZone(min: Vec3, max: Vec3): Trigger {
  return { type: 'void', min, max };
}
