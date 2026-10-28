import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, type Texture } from 'three';
import { type Brush, brushPolygons } from '../../shared/collision/brush';
import type { GameMap } from '../../shared/maps/types';
import { type Vec3, dot, normalize, vec3 } from '../../shared/math';

// Превращаем браши в треугольники для видеокарты. Так строятся карта, манекены и базука в руках.
//
// Свет «запекается» в цвета вершин заранее, поэтому в сцене нет ни одной лампы.
// Вся карта собирается в ОДИН меш = один draw call. Это главное правило скорости:
// видеокарте дешевле нарисовать один большой объект, чем сотню мелких.

/** Направление «солнца» для запечённого света */
const LIGHT = vec3(0.35, 1, 0.2);
normalize(LIGHT, LIGHT);
/** Одна клетка текстуры = 64 юнита (стандартная сетка Quake/TrenchBroom) */
const TEXEL = 1 / 64;

/** Геометрия из брашей: цвет браша × яркость грани, текстурные координаты по мировой сетке. */
export function buildBrushGeometry(brushes: readonly Brush[]): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];

  for (const brush of brushes) {
    const r = ((brush.color >> 16) & 255) / 255;
    const g = ((brush.color >> 8) & 255) / 255;
    const b = (brush.color & 255) / 255;

    for (const poly of brushPolygons(brush.planes)) {
      const shade = faceShade(poly.normal);
      const pts = poly.points;
      // Выпуклый многоугольник режем на треугольники «веером» от первой вершины
      for (let i = 1; i < pts.length - 1; i++) {
        for (const p of [pts[0], pts[i], pts[i + 1]]) {
          positions.push(p.x, p.y, p.z);
          colors.push(r * shade, g * shade, b * shade);
          pushPlanarUV(uvs, p, poly.normal);
        }
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Меш карты: вся карта одним объектом с текстурой. */
export function buildMapMesh(map: GameMap, texture: Texture): Mesh {
  // MeshBasicMaterial — самый дешёвый материал: без расчёта освещения
  const material = new MeshBasicMaterial({ map: texture, vertexColors: true });
  const mesh = new Mesh(buildBrushGeometry(map.brushes), material);
  mesh.matrixAutoUpdate = false; // карта не двигается — не пересчитываем её матрицу каждый кадр
  return mesh;
}

/** Яркость грани по направлению: верх светлый, бока темнее, низ тёмный. */
function faceShade(n: Vec3): number {
  return 0.4 + 0.6 * Math.max(0, dot(n, LIGHT));
}

/** Текстурные координаты из мировых: проецируем по оси, на которую грань смотрит сильнее всего. */
function pushPlanarUV(out: number[], p: Vec3, n: Vec3): void {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) out.push(p.x * TEXEL, p.z * TEXEL);
  else if (ax >= az) out.push(p.z * TEXEL, p.y * TEXEL);
  else out.push(p.x * TEXEL, p.y * TEXEL);
}
