import { createTrace, traceBox } from './collision/trace';
import { COMBAT, MOVE, PLAYER } from './config';
import { type Vec3, addScaled, copy, dot, lerp, normalize, scale, set, vec3 } from './math';
import { type PlayerState, eyeHeight, playerHalf } from './player';
import { type WeaponDef, WEAPONS, weaponIndex } from './weapons';
import type { Player, Rocket, World } from './world';

// ─────────────────────────────────────────────────────────────
// Бой: выстрел, полёт ракеты по дуге, попадание, взрыв, урон и отбрасывание.
// Формулы урона и отбрасывания — как в Quake 3.
// ─────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const AXES = ['x', 'y', 'z'] as const;
const ROCKET_HALF = vec3(COMBAT.rocketSize, COMBAT.rocketSize, COMBAT.rocketSize);
const POINT = vec3(0, 0, 0);

// Черновики
const tr = createTrace();
const end = vec3();
const dir = vec3();
/** Коробка игрока, раздутая на размер ракеты — для проверки прямого попадания */
const hitHalf = vec3();

// ─── Выстрел ────────────────────────────────────────────────

/**
 * Выпустить ракету(ы) из глаз игрока по направлению взгляда (из глаз — чтобы летела точно в прицел;
 * из ствола базуки её только рисует клиент).
 * На сервере и в песочнице ракеты настоящие. Клиент в сети запускает «предсказанные» (world.predictedRockets):
 * они вылетают сразу, без пинга, и толкают нас самих при рокет-джампе, но урон считает только сервер.
 */
export function fireWeapon(world: World, p: Player): void {
  const w = WEAPONS[p.weapon];
  if (w.remote) p.remoteSerial = p.rocketsFired; // этот снаряд ждёт второго нажатия
  p.cooldown = w.reload;
  world.events.push({ type: 'fire', playerId: p.id, weapon: p.weapon });

  const list = world.authority ? world.rockets : world.predictedRockets;
  const o = p.state.origin;
  const eye = eyeHeight(p.state);

  // Разброс от частой стрельбы: точка в круге радиусом p.bloom. «Случайная», но вычисленная из номера выстрела —
  // так сервер и клиент получают одно и то же отклонение (Math.random в shared/ нельзя)
  let bloomYaw = 0;
  let bloomPitch = 0;
  if (w.bloomPerShot && p.bloom > 0) {
    const angle = hash01(p.rocketsFired * 2) * Math.PI * 2;
    const radius = Math.sqrt(hash01(p.rocketsFired * 2 + 1)) * p.bloom * DEG;
    bloomYaw = Math.cos(angle) * radius;
    bloomPitch = Math.sin(angle) * radius;
  }
  if (w.bloomPerShot) p.bloom = Math.min(p.bloom + w.bloomPerShot, w.bloomMax ?? w.bloomPerShot * 3);

  for (let i = 0; i < w.rockets; i++) {
    // Веер: ракеты расходятся по горизонтали симметрично относительно прицела
    const yaw = p.cmd.yaw + (i - (w.rockets - 1) / 2) * w.spread * DEG + bloomYaw;
    const pitch = p.cmd.pitch + bloomPitch;
    const cosP = Math.cos(pitch);
    const vel = vec3(-Math.sin(yaw) * cosP, Math.sin(pitch), -Math.cos(yaw) * cosP);
    scale(vel, vel, w.speed);

    // Ракеты создаются только при выстреле (не каждый кадр), так что новый объект тут не страшен
    const start = vec3(o.x, o.y + eye, o.z);
    list.push({
      id: world.nextId++, ownerId: p.id, serial: p.rocketsFired++, weapon: p.weapon,
      pos: start, prevPos: copy(vec3(), start), vel, age: 0, bounces: w.bounces ?? 0,
    });
  }
}

// ─── Полёт ракет ────────────────────────────────────────────

export function updateRockets(world: World, dt: number): void {
  moveRockets(world, world.rockets, dt);
}

/** Полёт ракет из списка: дуга, стены, игроки, взрыв. Клиент в сети так же гоняет свои предсказанные ракеты. */
export function moveRockets(world: World, rockets: Rocket[], dt: number): void {
  // Идём с конца, чтобы безопасно удалять взорвавшиеся
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    const w = WEAPONS[r.weapon];
    copy(r.prevPos, r.pos);
    r.age += dt;

    if (r.age > w.lifetime) {
      explode(world, r, r.pos, null, false, true);
      removeAt(rockets, i);
      continue;
    }

    // Баллистика: гравитация тянет ракету вниз — отсюда дуга
    r.vel.y -= MOVE.gravity * w.gravity * dt;
    addScaled(end, r.pos, r.vel, dt);

    // Во что врежемся раньше: в стену или в игрока?
    traceBox(tr, world.map.brushes, r.pos, end, ROCKET_HALF);
    let hitFrac = tr.fraction;
    let hitPlayer: Player | null = null;
    let headshot = false;
    for (const p of world.players) {
      if (p.dead || p.id === r.ownerId) continue; // в себя напрямую попасть нельзя (только взрывом)
      const h = playerHalf(p.state);
      set(hitHalf, h.x + COMBAT.rocketSize, h.y + COMBAT.rocketSize, h.z + COMBAT.rocketSize);
      const f = segmentVsBox(r.pos, end, p.state.origin, hitHalf);
      if (f < hitFrac) {
        hitFrac = f;
        hitPlayer = p;
        // Хэдшот: точка попадания — в верхних headSize юнитах коробки
        const hitY = r.pos.y + (end.y - r.pos.y) * f;
        headshot = hitY > p.state.origin.y + h.y - PLAYER.headSize;
      }
    }

    if (hitFrac < 1 && !hitPlayer && r.bounces > 0) {
      // Граната отскакивает от стены: скорость отражаем от неё и чуть гасим
      copy(r.pos, tr.endPos);
      const n = tr.normal;
      addScaled(r.vel, r.vel, n, -2 * dot(r.vel, n));
      scale(r.vel, r.vel, w.bounceDamp ?? 0.6);
      r.bounces--;
    } else if (hitFrac < 1) {
      lerp(r.pos, r.pos, end, hitFrac);
      explode(world, r, r.pos, hitPlayer, headshot);
      removeAt(rockets, i);
    } else {
      copy(r.pos, end);
    }
  }
}

/**
 * Подорвать свой снаряд с подрывом по кнопке (WeaponDef.remote). Номер снаряда помним в p.remoteSerial (он же приходит
 * в снимке сервера) — поэтому и при повторе команд клиент решает так же, как сервер, даже если снаряд у него уже взорван.
 */
export function detonateRemote(world: World, p: Player): void {
  const list = world.authority ? world.rockets : world.predictedRockets;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.ownerId === p.id && r.serial === p.remoteSerial) {
      explode(world, r, r.pos, null);
      removeAt(list, i);
      break;
    }
  }
  p.remoteSerial = -1;
}

/** «Случайное» число 0..1 из целого n — всегда одно и то же для одного n (перемешивание битов, как в хеш-функциях). */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Быстрое удаление из массива: на место удаляемого ставим последний. */
function removeAt<T>(arr: T[], i: number): void {
  arr[i] = arr[arr.length - 1];
  arr.pop();
}

// ─── Взрыв и урон ───────────────────────────────────────────

function explode(world: World, r: Rocket, pos: Vec3, direct: Player | null, headshot = false, expired = false): void {
  const w = WEAPONS[r.weapon];
  // События создаются только при взрыве (не каждый кадр), так что новые объекты тут не страшны
  const flight = vec3();
  normalize(flight, r.vel);
  world.events.push({
    type: 'explode', pos: copy(vec3(), pos), weapon: r.weapon, ownerId: r.ownerId, serial: r.serial,
    dir: flight, hitPlayer: direct !== null, expired,
  });
  // Снаряд с подрывом по кнопке взорвался сам (врезался, кончилось время) — второе нажатие уже ничего не подорвёт
  if (w.remote) {
    const owner = world.players.find((p) => p.id === r.ownerId);
    if (owner && owner.remoteSerial === r.serial) owner.remoteSerial = -1;
  }
  // Клиент в сети: урон и толчки считает сервер (свой рокет-джамп предсказывает prediction.ts)
  if (!world.authority) return;

  // Прямое попадание: полный урон (в голову — больше), толкает по направлению полёта
  if (direct) {
    normalize(dir, r.vel);
    const damage = headshot ? (w.headDamage ?? w.directDamage * COMBAT.headshotScale) : w.directDamage;
    applyDamage(world, direct, r.ownerId, damage, dir, w.knockback, r.weapon, headshot);
  }

  // Взрывная волна по остальным
  for (const p of world.players) {
    if (p.dead || p === direct) continue;
    const damage = splashDamage(world, pos, w, p, dir);
    if (damage > 0) applyDamage(world, p, r.ownerId, damage, dir, w.knockback, r.weapon, false);
  }

  if (w.children) spawnChildren(world, r, pos, w.children);
}

/**
 * Осколки после взрыва (WeaponDef.children): кольцом во все стороны или дождём (см. pattern).
 * Всё вычисляется из номеров, без случайности: сервер и песочница получают одно и то же.
 * Только у сервера / в песочнице: клиент в сети видит их по снимкам. Номер у осколков −1 (не «свои ракеты»).
 */
function spawnChildren(world: World, parent: Rocket, pos: Vec3, c: NonNullable<WeaponDef['children']>): void {
  const weapon = weaponIndex(c.name);
  const def = WEAPONS[weapon];
  const rain = c.pattern === 'rain';
  for (let i = 0; i < c.count; i++) {
    let a: number;
    let speed: number;
    let up: number;
    if (rain) {
      // «Подсолнух»: поворот на золотой угол, расстояние от центра — √(доли), так точки ровно заполняют круг
      a = i * 2.39996 + parent.serial * 0.7;
      speed = c.speed * Math.sqrt((i + 0.5) / c.count);
      // Высота — вразнобой (перемешанная доля), чтобы не совпадала с расстоянием от центра
      const mix = ((i * 11) % c.count) / Math.max(1, c.count - 1);
      up = c.rise[0] + (c.rise[c.rise.length - 1] - c.rise[0]) * mix;
    } else {
      a = (i / c.count) * Math.PI * 2 + parent.serial * 0.7; // поворот кольца — от номера выстрела, не случайный
      speed = c.speed;
      up = c.rise[i % c.rise.length];
    }
    // Осколки создаются только при взрыве (не каждый кадр), так что новые объекты тут не страшны
    const start = vec3(pos.x, pos.y + 2, pos.z);
    world.rockets.push({
      id: world.nextId++, ownerId: parent.ownerId, serial: -1, weapon,
      pos: start, prevPos: copy(vec3(), start), vel: vec3(Math.cos(a) * speed, up, Math.sin(a) * speed),
      age: 0, bounces: def.bounces ?? 0,
    });
  }
}

/**
 * Взрывная волна по игроку: урон (от центра к краю радиуса падает до 0, стена гасит совсем)
 * и куда толкать (в dirOut). 0 — не задело. Отдельной функцией, чтобы клиент считал свой
 * рокет-джамп точь-в-точь как сервер.
 */
export function splashDamage(world: World, pos: Vec3, w: WeaponDef, p: Player, dirOut: Vec3): number {
  const o = p.state.origin;
  const dist = distanceToBox(pos, o, playerHalf(p.state));
  if (dist >= w.splashRadius) return 0;

  traceBox(tr, world.map.brushes, pos, o, POINT);
  if (tr.fraction < 1) return 0;

  // Толкаем от взрыва чуть выше центра игрока — так взрыв под ногами подбрасывает
  set(dirOut, o.x - pos.x, o.y + 20 - pos.y, o.z - pos.z);
  normalize(dirOut, dirOut);
  return w.splashDamage * (1 - (w.splashFalloff ?? 1) * (dist / w.splashRadius));
}

/** Толчок от взрыва. Считаем от ПОЛНОГО урона — поэтому рокет-джамп сильный, хотя по себе урон меньше. */
export function applyKnockback(ps: PlayerState, pushDir: Vec3, damage: number, knockbackScale: number): void {
  const push = Math.min(damage * COMBAT.knockbackPerDamage * knockbackScale, COMBAT.maxKnockback);
  addScaled(ps.velocity, ps.velocity, pushDir, push);
  ps.knockbackTime = Math.min(Math.max(push / 2500, 0.05), 0.2);
}

function applyDamage(
  world: World,
  target: Player,
  attackerId: number,
  damage: number,
  pushDir: Vec3,
  knockbackScale: number,
  weapon: number,
  headshot: boolean,
): void {
  if (target.dead) return;
  applyKnockback(target.state, pushDir, damage, knockbackScale);

  const dealt = target.id === attackerId ? damage * COMBAT.selfDamageScale : damage;
  target.health -= dealt;
  world.events.push({ type: 'damage', targetId: target.id, attackerId, amount: dealt, headshot });

  if (target.health <= 0) killPlayer(world, target, attackerId, weapon, headshot);
}

export function killPlayer(world: World, p: Player, attackerId: number, weapon: number, headshot = false): void {
  if (p.dead) return;
  p.dead = true;
  p.health = 0;
  p.respawnTimer = COMBAT.respawnDelay;
  world.events.push({ type: 'kill', targetId: p.id, attackerId, weapon, pos: copy(vec3(), p.state.origin), headshot });
}

// ─── Геометрия ──────────────────────────────────────────────

/** Расстояние от точки до коробки center±half (0, если точка внутри). */
function distanceToBox(p: Vec3, center: Vec3, half: Vec3): number {
  const dx = Math.max(Math.abs(p.x - center.x) - half.x, 0);
  const dy = Math.max(Math.abs(p.y - center.y) - half.y, 0);
  const dz = Math.max(Math.abs(p.z - center.z) - half.z, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** На какой доле отрезка a→b он входит в коробку center±half. 1 — не входит. */
function segmentVsBox(a: Vec3, b: Vec3, center: Vec3, half: Vec3): number {
  let tMin = 0;
  let tMax = 1;
  // Метод «пластин»: по каждой оси находим, когда отрезок внутри коробки, и пересекаем интервалы
  for (const axis of AXES) {
    const start = a[axis];
    const d = b[axis] - start;
    const lo = center[axis] - half[axis];
    const hi = center[axis] + half[axis];
    if (Math.abs(d) < 1e-9) {
      if (start < lo || start > hi) return 1;
      continue;
    }
    const t1 = (lo - start) / d;
    const t2 = (hi - start) / d;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return 1;
  }
  return tMin;
}
