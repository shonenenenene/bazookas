import type { Brush } from './collision/brush';
import { createTrace, traceBox } from './collision/trace';
import { MOVE, PLAYER } from './config';
import { type Vec3, addScaled, copy, cross, distSqXZ, dot, length, normalize, scale, set, vec3 } from './math';
import type { PlayerState, UserCmd } from './player';

// ─────────────────────────────────────────────────────────────
// Движение игрока в стиле Quake: земля, рампы и ступеньки как в Quake 3,
// управление в воздухе как в QuakeWorld.
//
// playerMove() детерминирована: одинаковые состояние и команда дают одинаковый результат.
// Поэтому сервер сможет запускать ровно этот код, а клиент — предсказывать своё движение.
//
// Откуда берутся трюки:
//  • банни-хоп — в тик прыжка трение не действует, скорость не теряется;
//  • стрейф-джамп — в воздухе ограничена только прибавка ВДОЛЬ нажатого направления
//    (airSpeedCap). Поворачивая мышь со стрейфом, добавляешь скорость «вбок» и
//    разгоняешься выше maxSpeed;
//  • серф — на крутых склонах не стоишь, а скользишь, и управление там как в воздухе.
// ─────────────────────────────────────────────────────────────

const half = PLAYER.halfExtents;

/** Немного «отталкиваемся» от плоскостей при скольжении, чтобы не залипать (OVERCLIP из Quake 3). */
const OVERCLIP = 1.001;
const MAX_CLIP_PLANES = 5;

// Черновики: создаются один раз, переиспользуются каждый тик
const tr = createTrace();
const wishDir = vec3();
const end = vec3();
const primalVel = vec3();
const originalVel = vec3();
const newVel = vec3();
const crease = vec3();
const clipPlanes = Array.from({ length: MAX_CLIP_PLANES }, () => vec3());
const startOrigin = vec3();
const startVel = vec3();
const downOrigin = vec3();
const downVel = vec3();

/** Один тик движения игрока. */
export function playerMove(ps: PlayerState, cmd: UserCmd, brushes: readonly Brush[], dt: number): void {
  if (ps.knockbackTime > 0) ps.knockbackTime = Math.max(0, ps.knockbackTime - dt);
  groundCheck(ps, brushes);
  updateJump(ps, cmd);

  if (ps.onGround) {
    // Сразу после взрыва трения нет — иначе отбрасывание вдоль пола гасло бы мгновенно
    if (ps.knockbackTime === 0) applyFriction(ps, dt);
    walkMove(ps, cmd, brushes, dt);
  } else {
    airMove(ps, cmd, brushes, dt);
  }

  groundCheck(ps, brushes);
}

// ─── Земля и прыжок ──────────────────────────────────────────

/** Стоим ли на полу: пробуем сдвинуться на 0.25 вниз. */
function groundCheck(ps: PlayerState, brushes: readonly Brush[]): void {
  const wasOnGround = ps.onGround;
  set(end, ps.origin.x, ps.origin.y - 0.25, ps.origin.z);
  traceBox(tr, brushes, ps.origin, end, half);

  // Под ногами пусто (или застряли в стене)
  if (tr.fraction === 1 || tr.allSolid) {
    ps.onGround = false;
    return;
  }
  // Летим вверх, прочь от поверхности (прыжок, взрыв ракеты) — это уже не стояние
  if (ps.velocity.y > 0 && dot(ps.velocity, tr.normal) > 10) {
    ps.onGround = false;
    return;
  }
  // Слишком крутой склон: на нём не стоят, а скользят
  if (tr.normal.y < MOVE.minWalkNormal) {
    ps.onGround = false;
    return;
  }

  ps.onGround = true;
  copy(ps.groundNormal, tr.normal);
  // Только что приземлились — гасим скорость, направленную «в пол»
  if (!wasOnGround && dot(ps.velocity, tr.normal) < 0) clipVelocity(ps.velocity, ps.velocity, tr.normal);
}

function updateJump(ps: PlayerState, cmd: UserCmd): void {
  if (!cmd.jump) {
    ps.jumpHeld = false;
    return;
  }
  if (!ps.onGround) return;
  if (ps.jumpHeld && !MOVE.autoHop) return; // без автохопа надо отпустить пробел между прыжками

  ps.onGround = false; // в этот тик трения не будет — в этом весь банни-хоп
  ps.jumpHeld = true;
  // Скорость вверх не обнуляем: прыжок с рампы вверх подбрасывает выше
  ps.velocity.y = Math.max(ps.velocity.y, 0) + MOVE.jumpVelocity;
}

function applyFriction(ps: PlayerState, dt: number): void {
  const v = ps.velocity;
  const speed = length(v);
  if (speed < 1) {
    set(v, 0, 0, 0);
    return;
  }
  const control = Math.max(speed, MOVE.stopSpeed);
  const newSpeed = Math.max(speed - control * MOVE.friction * dt, 0);
  scale(v, v, newSpeed / speed);
}

// ─── Разгон ─────────────────────────────────────────────────

/** Куда игрок хочет бежать (по горизонтали). Пишет направление в wishDir, возвращает желаемую скорость. */
function computeWish(cmd: UserCmd): number {
  const sin = Math.sin(cmd.yaw);
  const cos = Math.cos(cmd.yaw);
  // «вперёд» = (−sin, 0, −cos), «вправо» = (cos, 0, −sin)
  set(wishDir, -sin * cmd.forward + cos * cmd.right, 0, -cos * cmd.forward - sin * cmd.right);
  const amount = normalize(wishDir, wishDir);
  return Math.min(amount, 1) * MOVE.maxSpeed;
}

/**
 * Ускорение Quake: добавляем скорость вдоль dir, пока проекция скорости на dir не достигнет cap.
 * На земле cap = wishSpeed, в воздухе — маленький airSpeedCap (отсюда стрейф-джампы).
 */
function accelerate(v: Vec3, dir: Vec3, wishSpeed: number, accel: number, cap: number, dt: number): void {
  const addSpeed = Math.min(wishSpeed, cap) - dot(v, dir);
  if (addSpeed <= 0) return;
  addScaled(v, v, dir, Math.min(accel * wishSpeed * dt, addSpeed));
}

function walkMove(ps: PlayerState, cmd: UserCmd, brushes: readonly Brush[], dt: number): void {
  const wishSpeed = computeWish(cmd);
  // Направление бега кладём на плоскость пола — чтобы бежать вдоль рампы, а не в неё
  clipVelocity(wishDir, wishDir, ps.groundNormal);
  normalize(wishDir, wishDir);
  accelerate(ps.velocity, wishDir, wishSpeed, MOVE.groundAccel, wishSpeed, dt);

  // Скорость тоже кладём на пол, сохраняя её величину: на склонах не тормозим
  const speed = length(ps.velocity);
  if (speed === 0) return;
  clipVelocity(ps.velocity, ps.velocity, ps.groundNormal);
  normalize(ps.velocity, ps.velocity);
  scale(ps.velocity, ps.velocity, speed);

  stepSlideMove(ps, brushes, dt);
}

function airMove(ps: PlayerState, cmd: UserCmd, brushes: readonly Brush[], dt: number): void {
  const wishSpeed = computeWish(cmd);
  accelerate(ps.velocity, wishDir, wishSpeed, MOVE.airAccel, MOVE.airSpeedCap, dt);

  // Гравитация половинками до и после перемещения — так траектория точнее
  ps.velocity.y -= MOVE.gravity * dt * 0.5;
  stepSlideMove(ps, brushes, dt);
  ps.velocity.y -= MOVE.gravity * dt * 0.5;
}

// ─── Перемещение со скольжением ─────────────────────────────

/** out = v без составляющей «в плоскость» (с лёгким отталкиванием). */
function clipVelocity(out: Vec3, v: Vec3, normal: Vec3): void {
  let backoff = dot(v, normal);
  backoff = backoff < 0 ? backoff * OVERCLIP : backoff / OVERCLIP;
  addScaled(out, v, normal, -backoff);
}

/**
 * Двигаем игрока по скорости за dt, скользя вдоль всего, во что упёрлись.
 * Возвращает true, если во что-то врезались. (SV_FlyMove из Quake.)
 */
function slideMove(ps: PlayerState, brushes: readonly Brush[], dt: number): boolean {
  const v = ps.velocity;
  copy(primalVel, v);
  copy(originalVel, v);
  let timeLeft = dt;
  let numPlanes = 0;
  let blocked = false;

  for (let bump = 0; bump < 4; bump++) {
    if (v.x === 0 && v.y === 0 && v.z === 0) break;

    addScaled(end, ps.origin, v, timeLeft);
    traceBox(tr, brushes, ps.origin, end, half);

    if (tr.allSolid) {
      // Застряли внутри стены — стоим на месте
      set(v, 0, 0, 0);
      return true;
    }
    if (tr.fraction > 0) {
      copy(ps.origin, tr.endPos);
      copy(originalVel, v);
      numPlanes = 0;
    }
    if (tr.fraction === 1) break; // прошли весь путь без помех

    blocked = true;
    timeLeft -= timeLeft * tr.fraction;
    if (numPlanes >= MAX_CLIP_PLANES) {
      set(v, 0, 0, 0);
      return true;
    }
    copy(clipPlanes[numPlanes++], tr.normal);

    // Ищем скорость, которая идёт вдоль всех задетых плоскостей
    let found = false;
    for (let i = 0; i < numPlanes && !found; i++) {
      clipVelocity(newVel, originalVel, clipPlanes[i]);
      found = true;
      for (let j = 0; j < numPlanes; j++) {
        if (j !== i && dot(newVel, clipPlanes[j]) < 0) {
          found = false;
          break;
        }
      }
    }

    if (found) {
      copy(v, newVel);
    } else if (numPlanes === 2) {
      // Зажаты между двумя плоскостями — едем вдоль линии их пересечения (угол, «желоб»)
      cross(crease, clipPlanes[0], clipPlanes[1]);
      normalize(crease, crease);
      scale(v, crease, dot(crease, v));
    } else {
      set(v, 0, 0, 0);
      return true;
    }

    // Развернуло против исходного направления — останавливаемся, иначе будет дрожание в углах
    if (dot(v, primalVel) <= 0) {
      set(v, 0, 0, 0);
      return true;
    }
  }
  return blocked;
}

/**
 * slideMove, который умеет заходить на ступеньки до stepHeight.
 * Пробуем пройти «как есть» и «приподнявшись», оставляем вариант, который ушёл дальше.
 */
function stepSlideMove(ps: PlayerState, brushes: readonly Brush[], dt: number): void {
  copy(startOrigin, ps.origin);
  copy(startVel, ps.velocity);
  if (!slideMove(ps, brushes, dt)) return; // ни во что не упёрлись — готово

  // Летим вверх и под ногами нет пола → это прыжок, ступеньки не ищем
  set(end, startOrigin.x, startOrigin.y - MOVE.stepHeight, startOrigin.z);
  traceBox(tr, brushes, startOrigin, end, half);
  if (ps.velocity.y > 0 && (tr.fraction === 1 || tr.normal.y < MOVE.minWalkNormal)) return;

  // Запоминаем результат «как есть»
  copy(downOrigin, ps.origin);
  copy(downVel, ps.velocity);

  // Поднимаемся на высоту ступеньки (если потолок пускает) и пробуем ещё раз
  set(end, startOrigin.x, startOrigin.y + MOVE.stepHeight, startOrigin.z);
  traceBox(tr, brushes, startOrigin, end, half);
  if (tr.allSolid) return;
  const lifted = tr.endPos.y - startOrigin.y;
  copy(ps.origin, tr.endPos);
  copy(ps.velocity, startVel);
  slideMove(ps, brushes, dt);

  // Опускаемся обратно на поверхность
  set(end, ps.origin.x, ps.origin.y - lifted, ps.origin.z);
  traceBox(tr, brushes, ps.origin, end, half);
  if (!tr.allSolid) copy(ps.origin, tr.endPos);
  const landed = tr.fraction < 1 && tr.normal.y >= MOVE.minWalkNormal;
  if (tr.fraction < 1) clipVelocity(ps.velocity, ps.velocity, tr.normal);

  // Ступенька не помогла (не встали на пол или ушли не дальше) — берём вариант «как есть»
  if (!landed || distSqXZ(downOrigin, startOrigin) >= distSqXZ(ps.origin, startOrigin)) {
    copy(ps.origin, downOrigin);
    copy(ps.velocity, downVel);
  }
}
