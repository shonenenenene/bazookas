import type { Brush } from './collision/brush';
import { createTrace, traceBox } from './collision/trace';
import { MOVE, PLAYER } from './config';
import type { Trigger } from './maps/types';
import { type Vec3, addScaled, copy, cross, distSqXZ, dot, length, lengthXZ, normalize, scale, set, vec3 } from './math';
import type { PlayerState, UserCmd } from './player';

// ─────────────────────────────────────────────────────────────
// Движение игрока в стиле Quake: земля, рампы и ступеньки как в Quake 3,
// воздух как в CPMA, плюс паркур: подкат, отскок от стен, джамп-пады и бустеры.
//
// playerMove() детерминирована: одинаковые состояние и команда дают одинаковый результат.
// Поэтому сервер запускает ровно этот код, а клиент им же предсказывает своё движение.
// Всё, что движение помнит между тиками, лежит в PlayerState — больше нигде.
//
// Откуда берутся трюки:
//  • банни-хоп — прыжок только на нажатие пробела (удержание не прыгает). Нажал вовремя — чуть раньше
//    приземления или сразу после (MOVE.hopEarly / hopWindow) — трение не съедает скорость, и ещё прибавка (hopBoost);
//  • стрейф-джамп — с одной A или D в воздухе прибавка вдоль нажатого направления ограничена
//    (airSpeedCap). Поворачивая мышь со стрейфом, добавляешь скорость «вбок» и разгоняешься выше maxSpeed;
//  • управление в воздухе — W, S и диагонали тянут полёт в свою сторону, а одна W + мышь поворачивает
//    полёт без потери скорости (air control из CPMA);
//  • серф — на крутых склонах не стоишь, а скользишь, и управление там как в воздухе;
//  • подкат — присел на бегу: трения почти нет, с горки разгоняет;
//  • отскок от стены — врезался в полёте, жмёшь пробел. Вовремя (сразу после касания, как в бхопе) —
//    с ускорением туда, куда смотришь; позже — просто от стены. Три отскока за полёт;
//  • джамп-пад — прыжок, стоя на нём, подбрасывает высоко (горизонтальная скорость своя).
// ─────────────────────────────────────────────────────────────

const STAND = PLAYER.halfExtents;
const CROUCH = PLAYER.crouchHalfExtents;
/** На сколько опускается центр коробки, когда приседаешь на земле (ноги остаются на месте) */
const CROUCH_DROP = STAND.y - CROUCH.y;

/** Касание стены длится, пока она ближе этого (отлетели дальше — касание кончилось) */
const WALL_REACH = 8;
/** Стена — если нормаль почти горизонтальна; склоны для серфа и полы не подходят */
const WALL_MAX_NORMAL_Y = 0.2;
/** Отскок с ускорением летит, куда смотришь, но не вдоль и не в стену: «от стены» хотя бы на столько (cos) */
const WALLJUMP_MIN_AWAY = 0.3;

/** Немного «отталкиваемся» от плоскостей при скольжении, чтобы не залипать (OVERCLIP из Quake 3). */
const OVERCLIP = 1.001;
const MAX_CLIP_PLANES = 5;
const NO_TRIGGERS: readonly Trigger[] = [];

/** Коробка игрока в этом тике: стоя или присев. Ставится в начале playerMove */
let half: Vec3 = STAND;

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
/** slideMove отмечает тут, что упёрлись в отвесную стену (и её нормаль) — так замечаем касание стены */
let hitWall = false;
const hitWallNormal = vec3();

/**
 * Один тик движения игрока.
 * Возвращает, на сколько за тик резко подняло (+) или опустило (−): ступенька или присед на земле.
 * По этому числу клиент плавно двигает камеру, чтобы она не дёргалась.
 */
export function playerMove(
  ps: PlayerState,
  cmd: UserCmd,
  brushes: readonly Brush[],
  dt: number,
  triggers: readonly Trigger[] = NO_TRIGGERS,
): number {
  if (ps.knockbackTime > 0) ps.knockbackTime = Math.max(0, ps.knockbackTime - dt);
  ps.slideCooldown = Math.max(0, ps.slideCooldown - dt);
  ps.wallCooldown = Math.max(0, ps.wallCooldown - dt);

  let step = updateCrouch(ps, cmd, brushes);
  half = ps.crouched ? CROUCH : STAND;

  // Прыжок — на нажатие пробела. Нажал в воздухе — нажатие помнится hopEarly тиков, пока держишь
  const pressed = cmd.jump && !ps.jumpDown;
  const jumpNow = pressed || (cmd.jump && ps.jumpBuffer > 0);
  ps.jumpDown = cmd.jump;
  ps.jumpBuffer = pressed ? MOVE.hopEarly : Math.max(0, ps.jumpBuffer - 1);

  groundCheck(ps, brushes);
  // Предел 255 — чтобы число влезало в байт при отправке по сети
  ps.groundTicks = ps.onGround ? Math.min(ps.groundTicks + 1, 255) : 0;
  updateJump(ps, cmd, jumpNow, triggers);

  if (ps.onGround) {
    endWallTouch(ps);
    ps.wallJumps = 0; // на земле — снова можно отскакивать от стен
    updateSlide(ps);
    if (ps.sliding) {
      step += slideOnGround(ps, cmd, brushes, dt);
    } else {
      // Без трения: сразу после взрыва (иначе отбрасывание вдоль пола гасло бы мгновенно)
      // и в окне удачного хопа (успел нажать — скорость не потерял)
      if (ps.knockbackTime === 0 && ps.groundTicks > MOVE.hopWindow) applyFriction(ps, dt, MOVE.friction);
      step += walkMove(ps, cmd, brushes, dt);
    }
  } else {
    if (ps.wallTouch) updateWallTouch(ps, cmd, jumpNow, brushes, dt);
    step += airMove(ps, cmd, brushes, dt);
  }

  touchTriggers(ps, triggers, dt);
  groundCheck(ps, brushes);
  return step;
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
  // Летим вверх, прочь от поверхности (прыжок, взрыв ракеты) — это уже не стояние.
  // Порог 1, а не 0: крошки вроде 1e-70 от OVERCLIP иначе отрывали бы от склона на спуске
  if (ps.velocity.y > 1 && dot(ps.velocity, tr.normal) > 10) {
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

/** Прыжок с земли. jumpNow — пробел нажат в этот тик (или чуть раньше, в воздухе, и всё ещё зажат). */
function updateJump(ps: PlayerState, cmd: UserCmd, jumpNow: boolean, triggers: readonly Trigger[]): void {
  if (!ps.onGround) return;
  // Удержание прыгает, только если включён autoHop (и тогда без бонуса за удачный хоп)
  if (!jumpNow && !(MOVE.autoHop && cmd.jump)) return;

  ps.onGround = false; // в этот тик трения не будет — в этом весь банни-хоп
  ps.jumpBuffer = 0;
  // Удачный хоп: нажал вовремя — не позже hopWindow тиков после приземления (прыжок с места не считается)
  if (jumpNow && ps.groundTicks <= MOVE.hopWindow) hopBoost(ps.velocity);
  // Стоим на джамп-паде — прыжок высокий. Скорость вверх не обнуляем: прыжок с рампы вверх подбрасывает выше
  ps.velocity.y = Math.max(ps.velocity.y, 0) + padJumpVelocity(ps, triggers);
}

/** Скорость прыжка: с джамп-пада под ногами — его, иначе обычная. */
function padJumpVelocity(ps: PlayerState, triggers: readonly Trigger[]): number {
  for (const t of triggers) if (t.type === 'jumppad' && touches(ps.origin, t)) return t.jumpVelocity;
  return MOVE.jumpVelocity;
}

/** Касается ли коробка игрока зоны. */
function touches(o: Vec3, t: Trigger): boolean {
  return (
    o.x + half.x > t.min.x && o.x - half.x < t.max.x &&
    o.y + half.y > t.min.y && o.y - half.y < t.max.y &&
    o.z + half.z > t.min.z && o.z - half.z < t.max.z
  );
}

/** Прибавка за удачный хоп: разгоняемся в сторону, куда уже летим, но не выше hopBoostMaxSpeed. */
function hopBoost(v: Vec3): void {
  const speed = lengthXZ(v);
  if (speed < 1 || speed >= MOVE.hopBoostMaxSpeed) return;
  const k = Math.min(speed + MOVE.hopBoost, MOVE.hopBoostMaxSpeed) / speed;
  v.x *= k;
  v.z *= k;
}

function applyFriction(ps: PlayerState, dt: number, friction: number): void {
  const v = ps.velocity;
  const speed = length(v);
  if (speed < 1) {
    set(v, 0, 0, 0);
    return;
  }
  const control = Math.max(speed, MOVE.stopSpeed);
  const newSpeed = Math.max(speed - control * friction * dt, 0);
  scale(v, v, newSpeed / speed);
}

// ─── Присед и подкат ────────────────────────────────────────

/**
 * Присесть или встать. На земле ноги остаются на месте (центр коробки опускается),
 * в воздухе поджимаем ноги (центр на месте) — так можно запрыгнуть чуть выше.
 * Встаём, только если над головой есть место. Возвращает сдвиг центра — для плавной камеры.
 */
function updateCrouch(ps: PlayerState, cmd: UserCmd, brushes: readonly Brush[]): number {
  if (cmd.crouch === ps.crouched) return 0;
  if (cmd.crouch) {
    ps.crouched = true;
    if (!ps.onGround) return 0;
    ps.origin.y -= CROUCH_DROP;
    return -CROUCH_DROP;
  }
  const lift = ps.onGround ? CROUCH_DROP : 0;
  set(end, ps.origin.x, ps.origin.y + lift, ps.origin.z);
  traceBox(tr, brushes, end, end, STAND);
  if (tr.startSolid) return 0; // упираемся головой — сидим дальше
  ps.crouched = false;
  ps.sliding = false;
  ps.origin.y += lift;
  return lift;
}

/** Начать или закончить подкат: присел на скорости — поехал, скорость упала — просто сидишь. */
function updateSlide(ps: PlayerState): void {
  const speed = lengthXZ(ps.velocity);
  if (!ps.crouched || speed < MOVE.slideStopSpeed) {
    ps.sliding = false;
    return;
  }
  if (ps.sliding || speed < MOVE.slideMinSpeed) return;
  ps.sliding = true;
  // Рывок в начале подката
  if (ps.slideCooldown === 0 && speed < MOVE.slideBoostMaxSpeed) {
    ps.slideCooldown = MOVE.slideCooldown;
    const k = Math.min(speed + MOVE.slideBoost, MOVE.slideBoostMaxSpeed) / speed;
    ps.velocity.x *= k;
    ps.velocity.z *= k;
  }
}

/** Тик подката: трения почти нет, «газа» нет (только подруливание A/D), склон тянет вниз. */
function slideOnGround(ps: PlayerState, cmd: UserCmd, brushes: readonly Brush[], dt: number): number {
  if (ps.knockbackTime === 0) applyFriction(ps, dt, MOVE.slideFriction);

  // Часть гравитации вдоль пола: g минус его проекция на нормаль. На ровном полу это ноль
  const n = ps.groundNormal;
  const g = MOVE.gravity * MOVE.slideGravity * dt;
  ps.velocity.x += n.x * n.y * g;
  ps.velocity.y += -g + n.y * n.y * g;
  ps.velocity.z += n.z * n.y * g;

  if (cmd.forward === 0 && cmd.right !== 0) {
    const capped = Math.min(computeWish(cmd), MOVE.airSpeedCap);
    accelerate(ps.velocity, wishDir, capped, MOVE.airStrafeAccel, capped, dt);
  }
  return moveOnGround(ps, brushes, dt);
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
 * На земле cap = wishSpeed, в воздухе со стрейфом — маленький airSpeedCap (отсюда стрейф-джампы).
 */
function accelerate(v: Vec3, dir: Vec3, wishSpeed: number, accel: number, cap: number, dt: number): void {
  const addSpeed = Math.min(wishSpeed, cap) - dot(v, dir);
  if (addSpeed <= 0) return;
  addScaled(v, v, dir, Math.min(accel * wishSpeed * dt, addSpeed));
}

/** Бег по земле. Возвращает высоту ступеньки за тик (см. playerMove). */
function walkMove(ps: PlayerState, cmd: UserCmd, brushes: readonly Brush[], dt: number): number {
  let wishSpeed = computeWish(cmd);
  if (ps.crouched) wishSpeed *= MOVE.crouchSpeedScale;
  // Направление бега кладём на плоскость пола — чтобы бежать вдоль рампы, а не в неё
  clipVelocity(wishDir, wishDir, ps.groundNormal);
  normalize(wishDir, wishDir);
  accelerate(ps.velocity, wishDir, wishSpeed, MOVE.groundAccel, wishSpeed, dt);
  return moveOnGround(ps, brushes, dt);
}

/** Скорость кладём на пол (сохраняя величину: на склонах не тормозим), двигаемся, на спуске прижимаемся. */
function moveOnGround(ps: PlayerState, brushes: readonly Brush[], dt: number): number {
  const speed = length(ps.velocity);
  if (speed === 0) return 0;
  clipVelocity(ps.velocity, ps.velocity, ps.groundNormal);
  normalize(ps.velocity, ps.velocity);
  scale(ps.velocity, ps.velocity, speed);

  let step = stepSlideMove(ps, brushes, dt);
  // Не летим вверх → прижимаемся к полу. Если вверх (бежим по рампе), не прижимаем:
  // иначе с верхнего края рампы не получится вылететь.
  // Порог 1, а не 0: после «отталкивания» от пола (OVERCLIP) остаются крошки вроде 1e-67
  if (ps.velocity.y < 1) step += snapToGround(ps, brushes);
  return step;
}

/**
 * Полёт (как в CPMA). Только A или D — стрейф: маленький предел прибавки, сильное ускорение (бхоп, серф).
 * W, S, диагонали — тянут в нажатую сторону до скорости бега; одна W (или S) ещё и поворачивает полёт за мышью.
 * Возвращает высоту ступеньки за тик (см. playerMove).
 */
function airMove(ps: PlayerState, cmd: UserCmd, brushes: readonly Brush[], dt: number): number {
  const wishSpeed = computeWish(cmd);
  const v = ps.velocity;
  if (cmd.forward === 0 && cmd.right !== 0) {
    const capped = Math.min(wishSpeed, MOVE.airSpeedCap);
    accelerate(v, wishDir, capped, MOVE.airStrafeAccel, capped, dt);
  } else {
    const accel = dot(v, wishDir) < 0 ? MOVE.airStopAccel : MOVE.airAccel;
    accelerate(v, wishDir, wishSpeed, accel, wishSpeed, dt);
    if (cmd.right === 0) airControl(v, wishSpeed, dt);
  }

  // Гравитация половинками до и после перемещения — так траектория точнее
  v.y -= MOVE.gravity * dt * 0.5;
  const speedBefore = lengthXZ(v);
  hitWall = false;
  const step = stepSlideMove(ps, brushes, dt);
  v.y -= MOVE.gravity * dt * 0.5;
  // Врезались в стену — с этого тика можно отпрыгнуть (и успеть вовремя — за ускорением)
  if (hitWall && !ps.wallTouch) startWallTouch(ps, speedBefore);
  return step;
}

/**
 * Air control из CPMA: поворачиваем горизонтальную скорость к направлению взгляда, не меняя её величину.
 * Чем точнее смотришь туда, куда летишь, тем сильнее (dot²) — резко развернуться нельзя, только подрулить.
 */
function airControl(v: Vec3, wishSpeed: number, dt: number): void {
  if (wishSpeed === 0 || MOVE.airControl === 0) return;
  const speed = lengthXZ(v);
  if (speed < 1) return;
  const d = (v.x * wishDir.x + v.z * wishDir.z) / speed;
  if (d <= 0) return; // назад полёт не разворачиваем
  const k = 32 * MOVE.airControl * d * d * dt;
  const nx = v.x + wishDir.x * k;
  const nz = v.z + wishDir.z * k;
  const len = Math.sqrt(nx * nx + nz * nz);
  v.x = (nx / len) * speed;
  v.z = (nz / len) * speed;
}

// ─── Отскок от стены ────────────────────────────────────────

/** Врезались в стену в полёте (замечает airMove). Отскоки за полёт кончились или стена «остывает» — не считается. */
function startWallTouch(ps: PlayerState, speedBefore: number): void {
  if (ps.wallCooldown > 0 || ps.wallJumps >= MOVE.wallJumpsPerAir) return;
  ps.wallTouch = true;
  ps.wallTime = 0;
  ps.wallSpeed = speedBefore;
  copy(ps.wallNormal, hitWallNormal);
}

function endWallTouch(ps: PlayerState): void {
  ps.wallTouch = false;
}

/** Тик у стены: нажатие пробела — отскок. Отлетели от стены или она кончилась — касание закончилось. */
function updateWallTouch(ps: PlayerState, cmd: UserCmd, jumpNow: boolean, brushes: readonly Brush[], dt: number): void {
  ps.wallTime += dt;
  const n = ps.wallNormal;
  if (!probeWall(ps, brushes, -n.x, -n.z)) {
    endWallTouch(ps);
    return;
  }
  copy(n, tr.normal);

  // Отскок — на нажатие (или нажатие чуть раньше касания), а не на пробел, зажатый с прошлого прыжка
  if (jumpNow) wallJump(ps, cmd);
}

/** Есть ли отвесная стена в направлении (dx, 0, dz) ближе WALL_REACH. Результат — в tr. */
function probeWall(ps: PlayerState, brushes: readonly Brush[], dx: number, dz: number): boolean {
  set(end, ps.origin.x + dx * WALL_REACH, ps.origin.y, ps.origin.z + dz * WALL_REACH);
  traceBox(tr, brushes, ps.origin, end, half);
  return tr.fraction < 1 && !tr.startSolid && Math.abs(tr.normal.y) < WALL_MAX_NORMAL_Y;
}

/**
 * Отскок от стены. Вовремя (в первые wallJumpWindow секунд касания — как удачный бхоп): летим туда, куда смотрим
 * (но от стены), быстрее, чем врезались. Позже (после скольжения по стене) — обычный: от стены, вдоль — как летели.
 */
function wallJump(ps: PlayerState, cmd: UserCmd): void {
  const v = ps.velocity;
  const n = ps.wallNormal;
  if (ps.wallTime <= MOVE.wallJumpWindow) {
    let dx = -Math.sin(cmd.yaw);
    let dz = -Math.cos(cmd.yaw);
    // Смотрим вдоль стены или в неё — доворачиваем от стены, чтобы не прыгнуть обратно в неё
    const away = dx * n.x + dz * n.z;
    if (away < WALLJUMP_MIN_AWAY) {
      dx += n.x * (WALLJUMP_MIN_AWAY - away);
      dz += n.z * (WALLJUMP_MIN_AWAY - away);
    }
    const len = Math.sqrt(dx * dx + dz * dz);
    // Скорость не отнимаем, если и так летели быстрее предела
    const boosted = Math.max(ps.wallSpeed, Math.min(ps.wallSpeed + MOVE.wallJumpBoost, MOVE.wallJumpMaxSpeed));
    const speed = Math.max(boosted, MOVE.wallJumpPush);
    v.x = (dx / len) * speed;
    v.z = (dz / len) * speed;
  } else {
    // Составляющую «от стены» делаем ровно wallJumpPush, вдоль стены — оставляем
    const out = MOVE.wallJumpPush - (v.x * n.x + v.z * n.z);
    v.x += n.x * out;
    v.z += n.z * out;
  }
  v.y = Math.max(v.y, MOVE.wallJumpVelocity);
  ps.jumpBuffer = 0;
  ps.wallJumps++;
  ps.wallCooldown = MOVE.wallJumpCooldown;
  endWallTouch(ps);
}

// ─── Зоны карты ─────────────────────────────────────────────

/** Бустеры, которых касается коробка игрока (зона выше полосы — работают и в низком прыжке). Пады — в updateJump. */
function touchTriggers(ps: PlayerState, triggers: readonly Trigger[], dt: number): void {
  const v = ps.velocity;
  for (const t of triggers) {
    if (t.type !== 'booster' || !touches(ps.origin, t)) continue;
    const along = v.x * t.dir.x + v.z * t.dir.z;
    if (along >= t.speed) continue;
    const add = Math.min(t.accel * dt, t.speed - along);
    v.x += t.dir.x * add;
    v.z += t.dir.z * add;
  }
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
    if (Math.abs(tr.normal.y) < WALL_MAX_NORMAL_Y) {
      hitWall = true;
      copy(hitWallNormal, tr.normal);
    }
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
 * Возвращает, на сколько поднялись ступенькой (0 — не поднимались).
 */
function stepSlideMove(ps: PlayerState, brushes: readonly Brush[], dt: number): number {
  copy(startOrigin, ps.origin);
  copy(startVel, ps.velocity);
  if (!slideMove(ps, brushes, dt)) return 0; // ни во что не упёрлись — готово

  // Летим вверх и под ногами нет пола → это прыжок, ступеньки не ищем
  set(end, startOrigin.x, startOrigin.y - MOVE.stepHeight, startOrigin.z);
  traceBox(tr, brushes, startOrigin, end, half);
  if (ps.velocity.y > 0 && (tr.fraction === 1 || tr.normal.y < MOVE.minWalkNormal)) return 0;

  // Запоминаем результат «как есть»
  copy(downOrigin, ps.origin);
  copy(downVel, ps.velocity);

  // Поднимаемся на высоту ступеньки (если потолок пускает) и пробуем ещё раз
  set(end, startOrigin.x, startOrigin.y + MOVE.stepHeight, startOrigin.z);
  traceBox(tr, brushes, startOrigin, end, half);
  if (tr.allSolid) return 0;
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
    return 0;
  }
  hitWall = false; // поднялись на ступеньку — значит, это была не стена
  const climbed = ps.origin.y - startOrigin.y;
  return climbed > 2 ? climbed : 0; // мелочь (рампы, погрешности) за ступеньку не считаем
}

/**
 * Спуск по ступенькам без отрыва от пола (StayOnGround из Source): если пол не ниже высоты ступеньки,
 * встаём на него. Иначе с каждой ступеньки слетали бы и падали. Возвращает, на сколько опустились (≤ 0).
 */
function snapToGround(ps: PlayerState, brushes: readonly Brush[]): number {
  set(end, ps.origin.x, ps.origin.y - MOVE.stepHeight, ps.origin.z);
  traceBox(tr, brushes, ps.origin, end, half);
  if (tr.startSolid || tr.fraction === 1 || tr.normal.y < MOVE.minWalkNormal) return 0; // обрыв или склон для серфа
  const drop = tr.endPos.y - ps.origin.y;
  copy(ps.origin, tr.endPos);
  return drop < -2 ? drop : 0; // мелочь (рампы, погрешности) за ступеньку не считаем
}
