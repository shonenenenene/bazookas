// Проверки движения: бег, трение, прыжок, стены, ступеньки, рампы, банни-хоп (тайминг нажатия, удержание),
// разгон стрейфами, серф. Гоняем физику без браузера на тестовой арене.

import { boxBrush, brushPolygons } from '../src/shared/collision/brush';
import { MOVE, PLAYER, TICK_DT } from '../src/shared/config';
import { testMap } from '../src/shared/maps/testMap';
import { cross, dot, lengthXZ, set, vec3 } from '../src/shared/math';
import { playerMove } from '../src/shared/movement';
import { type PlayerState, type UserCmd, createPlayerState, createUserCmd, spawnPlayer } from '../src/shared/player';
import { check, round } from './check';

const brushes = testMap.brushes;

function fresh(x: number, z: number, yaw: number, feetY = 0) {
  const ps = createPlayerState();
  spawnPlayer(ps, { feet: vec3(x, feetY, z), yaw });
  const cmd = createUserCmd();
  cmd.yaw = yaw;
  return { ps, cmd };
}

function run(ps: PlayerState, cmd: UserCmd, ticks: number, each?: () => void) {
  for (let i = 0; i < ticks; i++) {
    each?.();
    playerMove(ps, cmd, brushes, TICK_DT);
  }
}

console.log('── движение ──');

// Грани брашей смотрят наружу (иначе видеокарта их не нарисует)
{
  let bad = 0;
  let total = 0;
  for (const b of brushes) {
    for (const p of brushPolygons(b.planes)) {
      total++;
      const [a, b2, c] = p.points;
      const n = cross(vec3(), vec3(b2.x - a.x, b2.y - a.y, b2.z - a.z), vec3(c.x - a.x, c.y - a.y, c.z - a.z));
      if (dot(n, p.normal) <= 0) bad++;
    }
  }
  check('winding', bad === 0, `bad=${bad}/${total}`);
}

// Стоим на полу, бежим, тормозим, прыгаем
{
  const { ps, cmd } = fresh(0, 600, 0);
  run(ps, cmd, 30);
  check('settle', ps.onGround && Math.abs(ps.origin.y - 28.125) < 0.2, `y=${round(ps.origin.y)}`);

  cmd.forward = 1;
  run(ps, cmd, 60);
  check('run speed', Math.abs(lengthXZ(ps.velocity) - 320) < 1, `speed=${round(lengthXZ(ps.velocity))}`);

  cmd.forward = 0;
  run(ps, cmd, 60);
  check('friction stop', lengthXZ(ps.velocity) === 0, `speed=${round(lengthXZ(ps.velocity))}`);

  const baseY = ps.origin.y;
  let maxY = baseY;
  cmd.jump = true;
  run(ps, cmd, 1);
  cmd.jump = false;
  run(ps, cmd, 50, () => (maxY = Math.max(maxY, ps.origin.y)));
  check('jump height', Math.abs(maxY - baseY - 45.6) < 3, `height=${round(maxY - baseY)} landed=${ps.onGround}`);
}

// Упираемся в северную стену
{
  const { ps, cmd } = fresh(-600, -800, 0);
  cmd.forward = 1;
  run(ps, cmd, 120);
  check('wall stop', Math.abs(ps.origin.z - (-1024 + 16 + 0.125)) < 0.2, `z=${round(ps.origin.z)}`);
}

// Лестница и рампы (yaw = PI/2 → бежим в −X, yaw = −PI/2 → в +X)
{
  const { ps, cmd } = fresh(-440, -320, Math.PI / 2);
  cmd.forward = 1;
  run(ps, cmd, 90);
  check('stairs', ps.origin.y > 155 && ps.origin.x < -780, `x=${round(ps.origin.x)} y=${round(ps.origin.y)}`);
}

// Лестница туда и обратно: каждая ступенька сообщается (по ним сглаживается камера),
// а вниз бежим, не отрываясь от пола
{
  const { ps, cmd } = fresh(-440, -320, Math.PI / 2);
  cmd.forward = 1;
  let ups = 0;
  for (let i = 0; i < 90; i++) if (playerMove(ps, cmd, brushes, TICK_DT) > 2) ups++;
  check('stairs steps', ups === 8, `steps up=${ups}`);

  cmd.yaw = -Math.PI / 2;
  let downs = 0;
  let airTicks = 0;
  for (let i = 0; i < 120; i++) {
    if (playerMove(ps, cmd, brushes, TICK_DT) < -2) downs++;
    if (!ps.onGround) airTicks++;
  }
  check('stairs down', downs === 8 && airTicks === 0 && ps.origin.y < 30, `steps down=${downs} air ticks=${airTicks}`);
}
{
  const { ps, cmd } = fresh(-480, -192, Math.PI / 2);
  cmd.forward = 1;
  run(ps, cmd, 90);
  check('ramp 30°', ps.origin.y > 155 && ps.origin.x < -780, `x=${round(ps.origin.x)} y=${round(ps.origin.y)}`);
}
{
  const { ps, cmd } = fresh(500, -320, -Math.PI / 2);
  cmd.forward = 1;
  run(ps, cmd, 90);
  check('ramp 45°', ps.origin.y > 219 && ps.origin.x > 780, `x=${round(ps.origin.x)} y=${round(ps.origin.y)}`);
}

// ─── Банни-хоп: прыжок только на нажатие, удачный хоп — нажал вовремя ───

const flat = [boxBrush(vec3(-1e5, -32, -1e5), vec3(1e5, 0, 1e5), 0)];

/** Идеальный игрок: жмёт пробел в первый же тик на земле (и отпускает в воздухе). */
const tapOnLanding = (ps: PlayerState, cmd: UserCmd) => (cmd.jump = ps.onGround && !cmd.jump);

/** Разбег по ровному полу и прыжок (пробел — на один тик). */
function runAndJump(ps: PlayerState, cmd: UserCmd) {
  cmd.forward = 1;
  for (let i = 0; i < 60; i++) playerMove(ps, cmd, flat, TICK_DT);
  cmd.jump = true;
  playerMove(ps, cmd, flat, TICK_DT);
  cmd.jump = false;
}

// По прямой (W + нажатия вовремя): удачные хопы разгоняют, но не выше hopBoostMaxSpeed
{
  const { ps, cmd } = fresh(0, 0, 0);
  cmd.forward = 1;
  for (let i = 0; i < 60; i++) playerMove(ps, cmd, flat, TICK_DT);
  let at3s = 0;
  for (let i = 0; i < 600; i++) {
    tapOnLanding(ps, cmd);
    playerMove(ps, cmd, flat, TICK_DT);
    if (i === 180) at3s = lengthXZ(ps.velocity);
  }
  const top = lengthXZ(ps.velocity);
  check('hop boost', at3s > 400 && Math.abs(top - MOVE.hopBoostMaxSpeed) < 1, `3s=${round(at3s)} 10s=${round(top)}`);
}

// Зажатый пробел прыгает один раз: после приземления стоим (autoHop выключен)
{
  const { ps, cmd } = fresh(0, 0, 0);
  for (let i = 0; i < 10; i++) playerMove(ps, cmd, flat, TICK_DT); // встали на пол
  cmd.jump = true;
  let jumps = 0;
  let wasGround = true;
  for (let i = 0; i < 120; i++) {
    playerMove(ps, cmd, flat, TICK_DT);
    if (wasGround && !ps.onGround) jumps++;
    wasGround = ps.onGround;
  }
  check('hop: holding = one jump', jumps === 1 && ps.onGround, `jumps in 2s=${jumps}`);
}

// Нажал чуть раньше приземления (за ~2 тика) и держишь — удачный хоп в первый тик на земле.
// Нажал поздно (через 8 тиков после приземления) — без бонуса, и трение уже съело скорость
{
  const early = fresh(0, 0, 0);
  runAndJump(early.ps, early.cmd);
  while (!early.ps.onGround) {
    // У земли падаем ~4.5 юнита за тик: ниже 9 над полом — жмём (и держим)
    const height = early.ps.origin.y - (PLAYER.halfExtents.y + 0.125);
    early.cmd.jump ||= early.ps.velocity.y < 0 && height < 9;
    playerMove(early.ps, early.cmd, flat, TICK_DT);
  }
  const landSpeed = lengthXZ(early.ps.velocity);
  playerMove(early.ps, early.cmd, flat, TICK_DT); // первый тик на земле — прыжок по запомненному нажатию
  const earlySpeed = lengthXZ(early.ps.velocity);
  const earlyOk = !early.ps.onGround && Math.abs(earlySpeed - (landSpeed + MOVE.hopBoost)) < 1;

  const late = fresh(0, 0, 0);
  runAndJump(late.ps, late.cmd);
  while (!late.ps.onGround) playerMove(late.ps, late.cmd, flat, TICK_DT);
  const before = lengthXZ(late.ps.velocity);
  late.cmd.forward = 0;
  for (let i = 0; i < 8; i++) playerMove(late.ps, late.cmd, flat, TICK_DT);
  late.cmd.jump = true;
  playerMove(late.ps, late.cmd, flat, TICK_DT);
  const lateSpeed = lengthXZ(late.ps.velocity);
  check(
    'hop timing',
    earlyOk && lateSpeed < before,
    `early: ${round(landSpeed)} → ${round(earlySpeed)}, late: ${round(before)} → ${round(lateSpeed)}`,
  );
}

// Банни-хоп со стрейфом: держим «вправо» перпендикулярно скорости — скорость должна расти выше 320
{
  const { ps, cmd } = fresh(-700, 900, 0);
  cmd.forward = 1;
  run(ps, cmd, 30);
  cmd.forward = 0;
  cmd.right = 1;
  let top = 0;
  run(ps, cmd, 180, () => {
    tapOnLanding(ps, cmd);
    const v = ps.velocity;
    const len = lengthXZ(v) || 1;
    cmd.yaw = Math.atan2(v.x / len, v.z / len); // «вправо» = перпендикуляр к скорости, закручиваем влево
    top = Math.max(top, lengthXZ(v));
  });
  check('strafe gain', top > 420, `top speed=${round(top)}`);
}

// Серф: падаем на крутой склон хребта, едем вдоль него и стрейфим в склон
{
  const { ps, cmd } = fresh(660, 0, Math.PI, 110);
  set(ps.velocity, 0, 0, 600);
  cmd.right = -1;
  let ground = false;
  run(ps, cmd, 60, () => (ground ||= ps.onGround));
  check('surf', !ground && ps.origin.z > 400 && ps.origin.y > 40, `z=${round(ps.origin.z)} y=${round(ps.origin.y)}`);
}
