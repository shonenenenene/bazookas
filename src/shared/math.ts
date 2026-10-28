// Мини-библиотека 3D-векторов без зависимостей (её использует и клиент, и будущий сервер).
//
// Функции пишут результат в `out`, а не создают новый объект. Так в игровом цикле
// не появляется мусор → сборщик мусора не устраивает микрофризы.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Создать вектор. Используй при инициализации, а не каждый кадр. */
export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  return set(out, a.x, a.y, a.z);
}

/** out = a - b */
export function sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(out, a.x - b.x, a.y - b.y, a.z - b.z);
}

/** out = a * s */
export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  return set(out, a.x * s, a.y * s, a.z * s);
}

/** out = a + b * s */
export function addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  return set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return set(out, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

/** Длина по горизонтали (без Y) — «скорость бега» для спидометра. */
export function lengthXZ(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.z * a.z);
}

/** Квадрат расстояния между точками (без корня — быстрее для сравнений). */
export function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Квадрат горизонтального расстояния между точками (без корня — быстрее для сравнений). */
export function distSqXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Делает длину 1. Возвращает исходную длину. Нулевой вектор остаётся нулевым. */
export function normalize(out: Vec3, a: Vec3): number {
  const len = length(a);
  if (len > 0) scale(out, a, 1 / len);
  else set(out, 0, 0, 0);
  return len;
}

/** Плавный переход: t = 0 → a, t = 1 → b. */
export function lerp(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  return set(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}
