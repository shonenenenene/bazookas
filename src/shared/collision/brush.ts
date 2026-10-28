import { type Vec3, cross, dot, normalize, vec3 } from '../math';

// Карта состоит из «брашей» — выпуклых блоков, как в Quake и в редакторе TrenchBroom.
// Браш задан плоскостями: точка внутри браша, если она «под» каждой из них.
// Из плоскостей получаем и столкновения (trace.ts), и полигоны для отрисовки.

/** Плоскость: точки p, где dot(normal, p) === dist. Нормаль смотрит из браша наружу. */
export interface Plane {
  normal: Vec3;
  dist: number;
}

/** Выпуклый блок карты. */
export interface Brush {
  planes: Plane[];
  /** Габаритная коробка — быстрая проверка «а близко ли вообще» */
  min: Vec3;
  max: Vec3;
  /** Цвет для отрисовки, 0xRRGGBB */
  color: number;
}

/** Грань браша: выпуклый многоугольник, вершины против часовой стрелки, если смотреть снаружи. */
export interface Polygon {
  normal: Vec3;
  points: Vec3[];
}

/** Плоскость по нормали (длина любая, нормализуем сами) и расстоянию. */
export function makePlane(nx: number, ny: number, nz: number, dist: number): Plane {
  const len = Math.hypot(nx, ny, nz);
  return { normal: vec3(nx / len, ny / len, nz / len), dist: dist / len };
}

/** Собрать браш из плоскостей. Габариты считаются по его граням. */
export function makeBrush(planes: Plane[], color: number): Brush {
  const min = vec3(Infinity, Infinity, Infinity);
  const max = vec3(-Infinity, -Infinity, -Infinity);
  for (const poly of brushPolygons(planes)) {
    for (const p of poly.points) {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
      max.z = Math.max(max.z, p.z);
    }
  }
  return { planes, min, max, color };
}

/** Шесть плоскостей коробки min..max. */
function boxPlanes(min: Vec3, max: Vec3): Plane[] {
  return [
    makePlane(1, 0, 0, max.x),
    makePlane(-1, 0, 0, -min.x),
    makePlane(0, 1, 0, max.y),
    makePlane(0, -1, 0, -min.y),
    makePlane(0, 0, 1, max.z),
    makePlane(0, 0, -1, -min.z),
  ];
}

/** Прямоугольный блок между двумя углами. */
export function boxBrush(min: Vec3, max: Vec3, color: number): Brush {
  return makeBrush(boxPlanes(min, max), color);
}

export type RampRise = '+x' | '-x' | '+z' | '-z';

/** Рампа (клин) в коробке min..max, поднимается в сторону `rise`. */
export function rampBrush(min: Vec3, max: Vec3, rise: RampRise, color: number): Brush {
  const h = max.y - min.y;
  const wx = max.x - min.x;
  const wz = max.z - min.z;
  // Наклонная плоскость проходит через нижний край на одной стороне и верхний на другой
  const slope =
    rise === '+x' ? makePlane(-h, wx, 0, -h * min.x + wx * min.y)
    : rise === '-x' ? makePlane(h, wx, 0, h * max.x + wx * min.y)
    : rise === '+z' ? makePlane(0, wz, -h, -h * min.z + wz * min.y)
    : makePlane(0, wz, h, h * max.z + wz * min.y);
  // Плоскости коробки оставляем: в столкновениях они работают как «фаски» (bevel planes из Quake 3)
  return makeBrush([...boxPlanes(min, max), slope], color);
}

// ─── Построение полигонов ────────────────────────────────────

const HUGE = 65536;
const EPS = 0.01;

/**
 * Превращает плоскости браша в многоугольники граней.
 * Для каждой плоскости берём огромный квадрат на ней и обрезаем его всеми остальными плоскостями.
 */
export function brushPolygons(planes: Plane[]): Polygon[] {
  const result: Polygon[] = [];
  for (let i = 0; i < planes.length; i++) {
    const { normal: n, dist } = planes[i];

    // Две оси (u, v) вдоль плоскости
    const u = cross(vec3(), Math.abs(n.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0), n);
    normalize(u, u);
    const v = cross(vec3(), n, u);
    const c = vec3(n.x * dist, n.y * dist, n.z * dist);
    const corner = (su: number, sv: number) =>
      vec3(c.x + u.x * su + v.x * sv, c.y + u.y * su + v.y * sv, c.z + u.z * su + v.z * sv);

    let points = [corner(HUGE, HUGE), corner(-HUGE, HUGE), corner(-HUGE, -HUGE), corner(HUGE, -HUGE)];
    for (let j = 0; j < planes.length && points.length >= 3; j++) {
      if (j !== i) points = clipPolygon(points, planes[j]);
    }
    // Вырожденные грани (например, у «фасок» рампы) отбрасываем
    if (points.length >= 3 && polygonArea(points) > 1) {
      result.push({ normal: vec3(n.x, n.y, n.z), points });
    }
  }
  return result;
}

/** Оставляет часть многоугольника, лежащую внутри плоскости (алгоритм Сазерленда — Ходжмана). */
function clipPolygon(points: Vec3[], plane: Plane): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k < points.length; k++) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    const da = dot(plane.normal, a) - plane.dist;
    const db = dot(plane.normal, b) - plane.dist;
    if (da <= EPS) out.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      out.push(vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
    }
  }
  return out;
}

/** Площадь выпуклого многоугольника (сумма площадей треугольников веером). */
function polygonArea(points: Vec3[]): number {
  const p0 = points[0];
  const sum = vec3();
  const c = vec3();
  for (let k = 1; k < points.length - 1; k++) {
    const a = points[k];
    const b = points[k + 1];
    cross(c, vec3(a.x - p0.x, a.y - p0.y, a.z - p0.z), vec3(b.x - p0.x, b.y - p0.y, b.z - p0.z));
    sum.x += c.x;
    sum.y += c.y;
    sum.z += c.z;
  }
  return Math.hypot(sum.x, sum.y, sum.z) / 2;
}
