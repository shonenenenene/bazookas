import { createTrace, traceBox } from './collision/trace';
import { COMBAT, MOVE } from './config';
import { type Vec3, addScaled, copy, lerp, normalize, scale, set, vec3 } from './math';
import { type PlayerState, eyeHeight, playerHalf } from './player';
import { type WeaponDef, WEAPONS } from './weapons';
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
  p.cooldown = w.reload;
  world.events.push({ type: 'fire', playerId: p.id, weapon: p.weapon });

  const list = world.authority ? world.rockets : world.predictedRockets;
  const o = p.state.origin;
  const eye = eyeHeight(p.state);
  for (let i = 0; i < w.rockets; i++) {
    // Веер: ракеты расходятся по горизонтали симметрично относительно прицела
    const yaw = p.cmd.yaw + (i - (w.rockets - 1) / 2) * w.spread * DEG;
    const pitch = p.cmd.pitch;
    const cosP = Math.cos(pitch);
    const vel = vec3(-Math.sin(yaw) * cosP, Math.sin(pitch), -Math.cos(yaw) * cosP);
    scale(vel, vel, w.speed);

    // Ракеты создаются только при выстреле (не каждый кадр), так что новый объект тут не страшен
    const start = vec3(o.x, o.y + eye, o.z);
    list.push({
      id: world.nextId++, ownerId: p.id, serial: p.rocketsFired++, weapon: p.weapon,
      pos: start, prevPos: copy(vec3(), start), vel, age: 0,
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
      const h = playerHalf(p.state);
      set(hitHalf, h.x + COMBAT.rocketSize, h.y + COMBAT.rocketSize, h.z + COMBAT.rocketSize);
      const f = segmentVsBox(r.pos, end, p.state.origin, hitHalf);
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
  world.events.push({ type: 'explode', pos: copy(vec3(), pos), weapon: r.weapon, ownerId: r.ownerId, serial: r.serial });
  // Клиент в сети: урон и толчки считает сервер (свой рокет-джамп предсказывает prediction.ts)
  if (!world.authority) return;

  // Прямое попадание: полный урон, толкает по направлению полёта
  if (direct) {
    normalize(dir, r.vel);
    applyDamage(world, direct, r.ownerId, w.directDamage, dir, w.knockback, r.weapon);
  }

  // Взрывная волна по остальным
  for (const p of world.players) {
    if (p.dead || p === direct) continue;
    const damage = splashDamage(world, pos, w, p, dir);
    if (damage > 0) applyDamage(world, p, r.ownerId, damage, dir, w.knockback, r.weapon);
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
  return w.splashDamage * (1 - dist / w.splashRadius);
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
): void {
  if (target.dead) return;
  applyKnockback(target.state, pushDir, damage, knockbackScale);

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
