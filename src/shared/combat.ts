import { createTrace, traceBox } from './collision/trace';
import { COMBAT, MOVE, PLAYER } from './config';
import { type Vec3, addScaled, copy, lerp, normalize, scale, set, vec3 } from './math';
import { WEAPONS } from './weapons';
import type { Player, Rocket, World } from './world';

// ─────────────────────────────────────────────────────────────
// Бой: выстрел, полёт ракеты по дуге, попадание, взрыв, урон и отбрасывание.
// Формулы урона и отбрасывания — как в Quake 3.
// ─────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const AXES = ['x', 'y', 'z'] as const;
const ROCKET_HALF = vec3(COMBAT.rocketSize, COMBAT.rocketSize, COMBAT.rocketSize);
const POINT = vec3(0, 0, 0);
/** Коробка игрока, раздутая на размер ракеты — для проверки прямого попадания */
const HIT_HALF = vec3(
  PLAYER.halfExtents.x + COMBAT.rocketSize,
  PLAYER.halfExtents.y + COMBAT.rocketSize,
  PLAYER.halfExtents.z + COMBAT.rocketSize,
);

// Черновики
const tr = createTrace();
const end = vec3();
const dir = vec3();

// ─── Выстрел ────────────────────────────────────────────────

/** Выпустить ракету(ы) из глаз игрока по направлению взгляда. */
export function fireWeapon(world: World, p: Player): void {
  const w = WEAPONS[p.weapon];
  p.cooldown = w.reload;

  const o = p.state.origin;
  for (let i = 0; i < w.rockets; i++) {
    // Веер: ракеты расходятся по горизонтали симметрично относительно прицела
    const yaw = p.cmd.yaw + (i - (w.rockets - 1) / 2) * w.spread * DEG;
    const pitch = p.cmd.pitch;
    const cosP = Math.cos(pitch);
    const vel = vec3(-Math.sin(yaw) * cosP, Math.sin(pitch), -Math.cos(yaw) * cosP);
    scale(vel, vel, w.speed);

    // Ракеты создаются только при выстреле (не каждый кадр), так что новый объект тут не страшен
    const start = vec3(o.x, o.y + PLAYER.eyeHeight, o.z);
    world.rockets.push({ id: world.nextId++, ownerId: p.id, weapon: p.weapon, pos: start, prevPos: copy(vec3(), start), vel, age: 0 });
  }
  world.events.push({ type: 'fire', playerId: p.id, weapon: p.weapon });
}

// ─── Полёт ракет ────────────────────────────────────────────

export function updateRockets(world: World, dt: number): void {
  const rockets = world.rockets;
  // Идём с конца, чтобы безопасно удалять взорвавшиеся
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    const w = WEAPONS[r.weapon];
    copy(r.prevPos, r.pos);
    r.age += dt;

    if (r.age > w.lifetime) {
      explode(world, r, r.pos, null);
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
    for (const p of world.players) {
      if (p.dead || p.id === r.ownerId) continue; // в себя напрямую попасть нельзя (только взрывом)
      const f = segmentVsBox(r.pos, end, p.state.origin, HIT_HALF);
      if (f < hitFrac) {
        hitFrac = f;
        hitPlayer = p;
      }
    }

    if (hitFrac < 1) {
      lerp(r.pos, r.pos, end, hitFrac);
      explode(world, r, r.pos, hitPlayer);
      removeAt(rockets, i);
    } else {
      copy(r.pos, end);
    }
  }
}

/** Быстрое удаление из массива: на место удаляемого ставим последний. */
function removeAt<T>(arr: T[], i: number): void {
  arr[i] = arr[arr.length - 1];
  arr.pop();
}

// ─── Взрыв и урон ───────────────────────────────────────────

function explode(world: World, r: Rocket, pos: Vec3, direct: Player | null): void {
  const w = WEAPONS[r.weapon];
  world.events.push({ type: 'explode', pos: copy(vec3(), pos), weapon: r.weapon });

  // Прямое попадание: полный урон, толкает по направлению полёта
  if (direct) {
    normalize(dir, r.vel);
    applyDamage(world, direct, r.ownerId, w.directDamage, dir, w.knockback, r.weapon);
  }

  // Взрывная волна: урон падает от центра к краю радиуса
  for (const p of world.players) {
    if (p.dead || p === direct) continue;
    const o = p.state.origin;
    const dist = distanceToBox(pos, o, PLAYER.halfExtents);
    if (dist >= w.splashRadius) continue;

    // Стена между взрывом и игроком гасит волну
    traceBox(tr, world.map.brushes, pos, o, POINT);
    if (tr.fraction < 1) continue;

    const damage = w.splashDamage * (1 - dist / w.splashRadius);
    // Толкаем от взрыва чуть выше центра игрока — так взрыв под ногами подбрасывает
    set(dir, o.x - pos.x, o.y + 20 - pos.y, o.z - pos.z);
    normalize(dir, dir);
    applyDamage(world, p, r.ownerId, damage, dir, w.knockback, r.weapon);
  }
}

function applyDamage(
  world: World,
  target: Player,
  attackerId: number,
  damage: number,
  dir: Vec3,
  knockbackScale: number,
  weapon: number,
): void {
  if (target.dead) return;

  // Отбрасывание считаем от ПОЛНОГО урона — поэтому рокет-джамп сильный, хотя по себе урон меньше
  const push = Math.min(damage * COMBAT.knockbackPerDamage * knockbackScale, COMBAT.maxKnockback);
  addScaled(target.state.velocity, target.state.velocity, dir, push);
  target.state.knockbackTime = Math.min(Math.max(push / 2500, 0.05), 0.2);

  const dealt = target.id === attackerId ? damage * COMBAT.selfDamageScale : damage;
  target.health -= dealt;
  world.events.push({ type: 'damage', targetId: target.id, attackerId, amount: dealt });

  if (target.health <= 0) killPlayer(world, target, attackerId, weapon);
}

export function killPlayer(world: World, p: Player, attackerId: number, weapon: number): void {
  if (p.dead) return;
  p.dead = true;
  p.health = 0;
  p.respawnTimer = COMBAT.respawnDelay;
  world.events.push({ type: 'kill', targetId: p.id, attackerId, weapon, pos: copy(vec3(), p.state.origin) });
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
