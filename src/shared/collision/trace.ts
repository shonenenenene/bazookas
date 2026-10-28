import { type Vec3, addScaled, copy, dot, set, sub, vec3 } from '../math';
import type { Brush, Plane } from './brush';

// Трассировка: «протаскиваем» коробку из start в end и узнаём, где она упрётся в стену.
// На этом построено всё: движение игрока, проверка пола, позже — полёт ракет.
//
// Трюк из Quake 3: вместо «коробка против браша» раздуваем плоскости браша на размер
// коробки и ведём через них точку. Это быстро и точно для блоков и рамп.

/** Результат трассировки. Создаётся один раз и переиспользуется. */
export interface TraceResult {
  /** Какая часть пути пройдена: 1 = прошли целиком, 0 = упёрлись сразу */
  fraction: number;
  /** Где остановились */
  endPos: Vec3;
  /** Нормаль поверхности, в которую упёрлись */
  normal: Vec3;
  /** Начали внутри стены */
  startSolid: boolean;
  /** Весь путь внутри стены (застряли) */
  allSolid: boolean;
}

/** Держим коробку чуть-чуть над поверхностью, чтобы не «залипать» в неё из-за погрешностей. */
const SURFACE_EPSILON = 0.125;

const delta = vec3(); // черновик, чтобы не создавать вектор на каждый вызов

export function createTrace(): TraceResult {
  return { fraction: 1, endPos: vec3(), normal: vec3(), startSolid: false, allSolid: false };
}

/**
 * Протащить коробку (половины размеров `half`) из start в end сквозь браши карты.
 * Результат пишется в `out`.
 */
export function traceBox(
  out: TraceResult,
  brushes: readonly Brush[],
  start: Vec3,
  end: Vec3,
  half: Vec3,
): TraceResult {
  out.fraction = 1;
  out.startSolid = false;
  out.allSolid = false;
  set(out.normal, 0, 0, 0);

  // Габариты всего пути — браши за их пределами сразу пропускаем
  const minX = Math.min(start.x, end.x) - half.x - 1;
  const minY = Math.min(start.y, end.y) - half.y - 1;
  const minZ = Math.min(start.z, end.z) - half.z - 1;
  const maxX = Math.max(start.x, end.x) + half.x + 1;
  const maxY = Math.max(start.y, end.y) + half.y + 1;
  const maxZ = Math.max(start.z, end.z) + half.z + 1;

  // Перебираем все браши подряд. Для карт до нескольких сотен брашей это быстро;
  // если карты вырастут — добавим сетку или дерево для поиска ближайших.
  for (const b of brushes) {
    if (b.max.x < minX || b.min.x > maxX || b.max.y < minY || b.min.y > maxY || b.max.z < minZ || b.min.z > maxZ) {
      continue;
    }
    clipToBrush(out, b, start, end, half);
    if (out.allSolid) break;
  }

  sub(delta, end, start);
  addScaled(out.endPos, start, delta, out.fraction);
  return out;
}

/** Проверка одного браша (CM_TraceThroughBrush из Quake 3). */
function clipToBrush(tr: TraceResult, brush: Brush, start: Vec3, end: Vec3, half: Vec3): void {
  let enterFrac = -1;
  let leaveFrac = 1;
  let hitPlane: Plane | null = null;
  let startOut = false;
  let endOut = false;

  for (const p of brush.planes) {
    const n = p.normal;
    // Сдвигаем плоскость наружу на «радиус» коробки в направлении нормали
    const dist = p.dist + Math.abs(n.x) * half.x + Math.abs(n.y) * half.y + Math.abs(n.z) * half.z;
    const d1 = dot(start, n) - dist;
    const d2 = dot(end, n) - dist;

    if (d2 > 0) endOut = true;
    if (d1 > 0) startOut = true;

    // Целиком снаружи этой плоскости → браш не задеваем вообще
    if (d1 > 0 && (d2 >= SURFACE_EPSILON || d2 >= d1)) return;
    // Целиком внутри этой плоскости → решают другие плоскости
    if (d1 <= 0 && d2 <= 0) continue;

    if (d1 > d2) {
      // Входим в браш через эту плоскость
      const f = Math.max(0, (d1 - SURFACE_EPSILON) / (d1 - d2));
      if (f > enterFrac) {
        enterFrac = f;
        hitPlane = p;
      }
    } else {
      // Выходим из браша через эту плоскость
      const f = Math.min(1, (d1 + SURFACE_EPSILON) / (d1 - d2));
      if (f < leaveFrac) leaveFrac = f;
    }
  }

  if (!startOut) {
    tr.startSolid = true;
    if (!endOut) {
      tr.allSolid = true;
      tr.fraction = 0;
    }
    return;
  }

  if (hitPlane && enterFrac < leaveFrac && enterFrac > -1 && enterFrac < tr.fraction) {
    tr.fraction = Math.max(0, enterFrac);
    copy(tr.normal, hitPlane.normal);
  }
}
