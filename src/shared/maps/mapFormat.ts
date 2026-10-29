import { type Brush, type Plane, boxPlanes, brushPolygons, makeBrush } from '../collision/brush';
import { PLAYER } from '../config';
import { type Vec3, cross, dot, normalize, sub, vec3 } from '../math';
import { TRIGGER_MATERIAL, materialColor, materialName } from './materials';
import { booster, checkpoint, jumpPad, voidZone } from './triggers';
import type { BotBehavior } from '../bots';
import type { DummySpawn, GameMap, SpawnPoint, Trigger } from './types';

// ─────────────────────────────────────────────────────────────
// Карты из TrenchBroom: чтение файла .map в GameMap и обратно (для карт, собранных кодом).
//
// Формат .map (Quake): сущности в фигурных скобках, у каждой — пары "ключ" "значение" и браши.
// Браш — несколько граней, грань — плоскость через три точки + имя текстуры:
//   ( x y z ) ( x y z ) ( x y z ) floor 0 0 0 1 1               — Standard
//   ( x y z ) ( x y z ) ( x y z ) floor [ … ] [ … ] 0 1 1        — Valve 220 (TrenchBroom по умолчанию)
// Текстурные координаты нам не нужны: цвет блока берётся по имени текстуры (materials.ts).
//
// ОСИ: в Quake вверх — Z, у нас (как в Three.js) — Y. Точка Quake (x, y, z) → наша (x, z, −y).
// Сущности, которые мы понимаем (их описание для редактора — trenchbroom/bazookas.fgd):
//   worldspawn             — сама карта; ключи message (название), description (пара строк для меню), sky_color,
//                            fog_near, fog_far, sky (space — космос), training 1 — тренировочная (манекены, вне смены карт)
//   info_preview           — откуда снимать превью для меню (angle — куда смотрим, pitch — вверх/вниз в градусах)
//   info_player_deathmatch — точка появления (angle — куда смотрим)
//   bazooka_dummy          — манекен (name, bot: idle / strafe / bhop, angle)
//   trigger_jumppad        — джамп-пад (height — высота прыжка)
//   trigger_booster        — бустер (angle — направление, speed, accel)
//   trigger_checkpoint     — чекпоинт: target — имя info_checkpoint, где появишься (нет — низ середины зоны, angle);
//                            reset 1 — финиш, забыть чекпоинт
//   info_checkpoint        — точка появления для чекпоинта (targetname, angle, speed — скорость вперёд при появлении)
//   trigger_void           — пустота: упал — на последний чекпоинт (или гибнешь, если чекпоинтов нет)
// Остальные браш-сущности (func_group — группы и слои TrenchBroom и т.п.) — обычная геометрия карты.
// ─────────────────────────────────────────────────────────────

/** Точка появления в редакторе — центр коробки игрока, а у нас — ноги: разница в полроста */
const SPAWN_LIFT = PLAYER.halfExtents.y;
const DEG = Math.PI / 180;
const TRIGGER_CLASSES = ['trigger_jumppad', 'trigger_booster', 'trigger_checkpoint', 'trigger_void'];

interface RawEntity {
  keys: Record<string, string>;
  /** Браши: у каждой грани — три точки (уже в наших осях) и текстура */
  brushes: { points: [Vec3, Vec3, Vec3]; material: string }[][];
}

/** Прочитать .map. name — имя карты (из имени файла), если в worldspawn нет message. */
export function parseMap(text: string, name: string): GameMap {
  const entities = readEntities(text);
  const map: GameMap = {
    name, brushes: [], spawns: [], dummies: [], triggers: [],
    skyColor: 0x0d0612, fogNear: 300, fogFar: 2600,
  };

  // Точки чекпоинтов по имени — на них ссылаются зоны trigger_checkpoint (ключ target)
  const targets = new Map<string, SpawnPoint>();
  for (const e of entities) {
    if (e.keys.classname === 'info_checkpoint' && e.keys.targetname) {
      const sp = spawnOf(e);
      if (e.keys.speed) sp.speed = Number(e.keys.speed);
      targets.set(e.keys.targetname, sp);
    }
  }

  for (const e of entities) {
    const cls = e.keys.classname ?? '';
    if (cls === 'worldspawn') {
      if (e.keys.message) map.name = e.keys.message;
      if (e.keys.sky_color) map.skyColor = parseInt(e.keys.sky_color.replace('#', ''), 16);
      if (e.keys.fog_near) map.fogNear = Number(e.keys.fog_near);
      if (e.keys.fog_far) map.fogFar = Number(e.keys.fog_far);
      if (e.keys.sky === 'space') map.sky = 'space';
      if (e.keys.description) map.description = e.keys.description;
      if (e.keys.training === '1') map.training = true;
    }

    if (cls === 'info_preview') {
      const [x, y, z] = (e.keys.origin ?? '0 0 0').split(/\s+/).map(Number);
      map.preview = { eye: fromQuake(x, y, z), yaw: yawFromAngle(Number(e.keys.angle ?? 0)), pitch: Number(e.keys.pitch ?? 0) * DEG };
    } else if (cls === 'info_player_deathmatch' || cls === 'info_player_start') {
      map.spawns.push(spawnOf(e));
    } else if (cls === 'bazooka_dummy') {
      const bot = (['idle', 'strafe', 'bhop'].includes(e.keys.bot) ? e.keys.bot : 'idle') as BotBehavior;
      const dummy: DummySpawn = { name: e.keys.name || 'dummy', spawn: spawnOf(e), bot };
      map.dummies.push(dummy);
    } else if (TRIGGER_CLASSES.includes(cls)) {
      for (const faces of e.brushes) {
        const { min, max } = buildBrush(faces);
        map.triggers.push(triggerOf(e, cls, min, max, targets));
      }
    } else {
      // worldspawn и любые другие браш-сущности (группы, слои) — геометрия карты
      for (const faces of e.brushes) map.brushes.push(buildBrush(faces));
    }
  }

  if (map.spawns.length === 0) map.spawns.push({ feet: vec3(0, 0, 0), yaw: 0 });
  return map;
}

/** Разобрать текст на сущности. Построчно: TrenchBroom пишет каждую грань и каждый ключ своей строкой. */
function readEntities(text: string): RawEntity[] {
  const entities: RawEntity[] = [];
  let entity: RawEntity | null = null;
  let brush: RawEntity['brushes'][number] | null = null;
  let depth = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line === '{') {
      depth++;
      if (depth === 1) entity = { keys: {}, brushes: [] };
      else if (depth === 2 && entity) entity.brushes.push((brush = []));
      continue;
    }
    if (line === '}') {
      if (depth === 1 && entity) entities.push(entity);
      depth--;
      continue;
    }
    if (depth === 1 && entity) {
      const kv = /^"([^"]*)"\s+"([^"]*)"$/.exec(line);
      if (kv) entity.keys[kv[1]] = kv[2];
    } else if (depth === 2 && brush && line.startsWith('(')) {
      const face = readFace(line);
      if (face) brush.push(face);
    }
  }
  return entities;
}

const POINT_RE = /\(\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s*\)/g;

/** Грань: три точки и имя текстуры сразу после них. */
function readFace(line: string): { points: [Vec3, Vec3, Vec3]; material: string } | null {
  const pts: Vec3[] = [];
  let end = 0;
  POINT_RE.lastIndex = 0;
  for (let i = 0; i < 3; i++) {
    const m = POINT_RE.exec(line);
    if (!m) return null;
    pts.push(fromQuake(Number(m[1]), Number(m[2]), Number(m[3])));
    end = POINT_RE.lastIndex;
  }
  // Имя текстуры; если лежит в подпапке («base/floor») — берём только имя
  const material = (line.slice(end).trim().split(/\s+/)[0] ?? 'wall').split('/').pop()!;
  return { points: [pts[0], pts[1], pts[2]], material };
}

/**
 * Браш из граней. Нормаль грани — как в Quake: cross(p0 − p1, p2 − p1), смотрит из браша наружу.
 * Добавляем «фаски» — плоскости габаритной коробки (как у рамп в brush.ts): форма от них не меняется,
 * а коробка игрока не цепляется за острые рёбра при столкновениях.
 */
function buildBrush(faces: { points: [Vec3, Vec3, Vec3]; material: string }[]): Brush {
  const planes: Plane[] = [];
  for (const { points: [p0, p1, p2] } of faces) {
    const n = cross(vec3(), sub(vec3(), p0, p1), sub(vec3(), p2, p1));
    normalize(n, n);
    planes.push({ normal: n, dist: dot(n, p1) });
  }
  // Цвет — по первой грани, у которой текстура не «служебная»
  const material = faces.find((f) => f.material !== TRIGGER_MATERIAL)?.material ?? TRIGGER_MATERIAL;
  const shape = makeBrush(planes, materialColor(material));
  for (const bevel of boxPlanes(shape.min, shape.max)) {
    if (!planes.some((p) => dot(p.normal, bevel.normal) > 0.9999)) planes.push(bevel);
  }
  return shape;
}

function spawnOf(e: RawEntity): SpawnPoint {
  const [x, y, z] = (e.keys.origin ?? '0 0 0').split(/\s+/).map(Number);
  const o = fromQuake(x, y, z);
  o.y -= SPAWN_LIFT;
  return { feet: o, yaw: yawFromAngle(Number(e.keys.angle ?? 0)) };
}

function triggerOf(e: RawEntity, cls: string, min: Vec3, max: Vec3, targets: Map<string, SpawnPoint>): Trigger {
  if (cls === 'trigger_jumppad') return jumpPad(min, max, Number(e.keys.height ?? 500));
  if (cls === 'trigger_checkpoint') {
    const yaw = yawFromAngle(Number(e.keys.angle ?? 90));
    return checkpoint(min, max, yaw, e.keys.reset === '1', targets.get(e.keys.target ?? ''));
  }
  if (cls === 'trigger_void') return voidZone(min, max);
  const a = Number(e.keys.angle ?? 0) * DEG;
  // Угол Quake: 0 — на восток (+X), 90 — на север (Quake +Y = наш −Z)
  return booster(min, max, Math.cos(a), -Math.sin(a), Number(e.keys.speed ?? 900), Number(e.keys.accel ?? 6000));
}

/** Угол Quake (градусы, 0 — восток, против часовой) → наш yaw (0 — смотрим в −Z, растёт влево). */
function yawFromAngle(angle: number): number {
  return (angle - 90) * DEG;
}

function fromQuake(x: number, y: number, z: number): Vec3 {
  return vec3(x, z, -y);
}

// ─── Запись .map (карты, собранные кодом → в TrenchBroom) ─────

/** Выгрузить карту в .map (формат Standard — TrenchBroom его понимает и сам переведёт в Valve при сохранении). */
export function writeMap(map: GameMap): string {
  const out: string[] = [];
  let entityIndex = 0;
  const entity = (keys: Record<string, string | number>, brushes: string[] = []) => {
    out.push(`// entity ${entityIndex++}`, '{');
    for (const [k, v] of Object.entries(keys)) out.push(`"${k}" "${v}"`);
    brushes.forEach((b, i) => out.push(`// brush ${i}`, b));
    out.push('}');
  };

  entity(
    {
      classname: 'worldspawn',
      message: map.name,
      sky_color: '#' + map.skyColor.toString(16).padStart(6, '0'),
      fog_near: map.fogNear,
      fog_far: map.fogFar,
      ...(map.sky ? { sky: map.sky } : {}),
      ...(map.description ? { description: map.description.replace(/"/g, "'") } : {}),
      ...(map.training ? { training: 1 } : {}),
    },
    map.brushes.map((b) => brushText(b, materialName(b.color))),
  );
  for (const s of map.spawns) entity({ classname: 'info_player_deathmatch', origin: originText(s), angle: angleText(s.yaw) });
  if (map.preview) {
    const p = map.preview;
    entity({ classname: 'info_preview', origin: `${num(p.eye.x)} ${num(-p.eye.z)} ${num(p.eye.y)}`, angle: angleText(p.yaw), pitch: Math.round(p.pitch / DEG) });
  }
  for (const d of map.dummies) {
    entity({ classname: 'bazooka_dummy', name: d.name, bot: d.bot, origin: originText(d.spawn), angle: angleText(d.spawn.yaw) });
  }
  let checkpoints = 0;
  for (const t of map.triggers) {
    const box = brushText(makeBrush(boxPlanes(t.min, t.max), 0), TRIGGER_MATERIAL);
    if (t.type === 'jumppad') entity({ classname: 'trigger_jumppad', height: t.height }, [box]);
    else if (t.type === 'checkpoint') {
      const name = `cp${++checkpoints}`;
      entity({ classname: 'trigger_checkpoint', target: name, ...(t.reset ? { reset: 1 } : {}) }, [box]);
      const keys: Record<string, string | number> = { classname: 'info_checkpoint', targetname: name, origin: originText(t.spawn), angle: angleText(t.spawn.yaw) };
      if (t.spawn.speed) keys.speed = t.spawn.speed;
      entity(keys);
    } else if (t.type === 'void') entity({ classname: 'trigger_void' }, [box]);
    else {
      const angle = Math.round(Math.atan2(-t.dir.z, t.dir.x) / DEG);
      entity({ classname: 'trigger_booster', angle, speed: t.speed, accel: t.accel }, [box]);
    }
  }
  return out.join('\n') + '\n';
}

/** Браш текстом: по грани на строку, три точки так, чтобы нормаль по формуле Quake смотрела наружу. */
function brushText(b: Brush, material: string): string {
  const lines = ['{'];
  for (const poly of brushPolygons(b.planes)) {
    let [p0, p1, p2] = poly.points;
    const n = cross(vec3(), sub(vec3(), p0, p1), sub(vec3(), p2, p1));
    if (dot(n, poly.normal) < 0) [p0, p2] = [p2, p0];
    lines.push(`${pointText(p0)} ${pointText(p1)} ${pointText(p2)} ${material} 0 0 0 1 1`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** Наша точка → Quake: (x, y, z) → (x, −z, y). Почти целые числа округляем — так чище в редакторе. */
function pointText(p: Vec3): string {
  return `( ${num(p.x)} ${num(-p.z)} ${num(p.y)} )`;
}

function originText(s: SpawnPoint): string {
  return `${num(s.feet.x)} ${num(-s.feet.z)} ${num(s.feet.y + SPAWN_LIFT)}`;
}

function angleText(yaw: number): number {
  return Math.round(((yaw / DEG + 90) % 360 + 360) % 360);
}

function num(v: number): string {
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-3 ? String(r) : v.toFixed(3);
}
