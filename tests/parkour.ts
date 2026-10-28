// Проверки управления в воздухе и паркура: W в прыжке, поворот полёта мышью, тормоз,
// подкат (по ровному и с горки), низкие ворота, отскок от стены (вовремя — с ускорением, поздно — без),
// три отскока за полёт, джамп-пад (только с прыжка), бустер.

import { type Brush, boxBrush } from '../src/shared/collision/brush';
import { MOVE, PLAYER, TICK_DT } from '../src/shared/config';
import { testMap } from '../src/shared/maps/testMap';
import { lengthXZ, set, vec3 } from '../src/shared/math';
import { playerMove } from '../src/shared/movement';
import { type PlayerState, type UserCmd, createPlayerState, createUserCmd, spawnPlayer } from '../src/shared/player';
import { check, round } from './check';

console.log('\n── паркур ──');

const { brushes, triggers } = testMap;
/** Бесконечный ровный пол */
const flat = [boxBrush(vec3(-1e5, -32, -1e5), vec3(1e5, 0, 1e5), 0)];
/** Пол и длинная высокая стена справа от x = 100 */
const wallWorld = [...flat, boxBrush(vec3(100, 0, -5000), vec3(116, 600, 5000), 0)];

function fresh(x: number, z: number, yaw: number, feetY = 0) {
  const ps = createPlayerState();
  spawnPlayer(ps, { feet: vec3(x, feetY, z), yaw });
  const cmd = createUserCmd();
  cmd.yaw = yaw;
  return { ps, cmd };
}

function run(ps: PlayerState, cmd: UserCmd, world: readonly Brush[], ticks: number, each?: () => void) {
  for (let i = 0; i < ticks; i++) {
    each?.();
    playerMove(ps, cmd, world, TICK_DT, world === brushes ? triggers : undefined);
  }
}

const EAST = -Math.PI / 2; // yaw: смотрим в +X

// ─── Воздух ───

// Прыжок с места с зажатой W: раньше в полёте было 30 u/s, теперь полёт тянет вперёд
{
  const { ps, cmd } = fresh(0, 0, 0);
  run(ps, cmd, flat, 20);
  Object.assign(cmd, { forward: 1, jump: true });
  run(ps, cmd, flat, 1);
  cmd.jump = false;
  let speed = 0;
  run(ps, cmd, flat, 40, () => {
    if (!ps.onGround) speed = lengthXZ(ps.velocity);
  });
  check('air: W from standstill', speed > 150, `speed in air=${round(speed)}`);
}

// W + мышь: летим на восток, за полёт поворачиваем взгляд на 90° влево — полёт поворачивает следом, скорость та же
{
  const { ps, cmd } = fresh(0, 0, EAST);
  cmd.forward = 1;
  run(ps, cmd, flat, 60);
  const start = lengthXZ(ps.velocity);
  cmd.jump = true;
  run(ps, cmd, flat, 1);
  cmd.jump = false;
  run(ps, cmd, flat, 30, () => (cmd.yaw += Math.PI / 2 / 30));
  const v = ps.velocity;
  const turned = Math.abs(v.z) > Math.abs(v.x); // на север (−Z) — больше, чем на восток
  check('air: W + mouse steers', turned && lengthXZ(v) > start * 0.95, `v=(${round(v.x)}, ${round(v.z)}) start=${round(start)}`);
}

// Тормоз: летим 500 u/s, жмём S — за 0.3 с скорость заметно падает
{
  const { ps, cmd } = fresh(0, 0, EAST, 400);
  set(ps.velocity, 500, 0, 0);
  cmd.forward = -1;
  run(ps, cmd, flat, 18);
  check('air: S brakes', lengthXZ(ps.velocity) < 300, `speed=${round(lengthXZ(ps.velocity))}`);
}

// ─── Подкат ───

// По ровному: разбег, Shift — рывок и долгое скольжение (без подката встали бы за ~60 юнитов)
{
  const { ps, cmd } = fresh(0, 0, EAST);
  cmd.forward = 1;
  run(ps, cmd, flat, 60);
  cmd.forward = 0;
  cmd.crouch = true;
  run(ps, cmd, flat, 1);
  const boosted = lengthXZ(ps.velocity);
  const x0 = ps.origin.x;
  let ticks = 0;
  while (ps.sliding && ticks < 600) {
    run(ps, cmd, flat, 1);
    ticks++;
  }
  const dist = ps.origin.x - x0;
  check('slide', boosted > 390 && dist > 400 && ps.crouched, `boost=${round(boosted)} distance=${round(dist)} time=${round(ticks / 60)}s`);
}

// С горки (западная рампа 30°): склон разгоняет подкат
{
  const { ps, cmd } = fresh(-860, -192, EAST, 128);
  cmd.forward = 1;
  run(ps, cmd, brushes, 25);
  cmd.forward = 0;
  cmd.crouch = true;
  let top = 0;
  run(ps, cmd, brushes, 60, () => (top = Math.max(top, lengthXZ(ps.velocity))));
  check('slide downhill', top > 430, `top speed=${round(top)} (рывок даёт ~400, остальное — склон)`);
}

// Низкие ворота (проезд 44): стоя упираемся, присев — проходим; встать под балкой нельзя
{
  const standing = fresh(-460, -620, 0);
  standing.cmd.forward = 1;
  run(standing.ps, standing.cmd, brushes, 60);

  const crouching = fresh(-460, -620, 0);
  Object.assign(crouching.cmd, { forward: 1, crouch: true });
  run(crouching.ps, crouching.cmd, brushes, 30); // доползли до балки
  crouching.cmd.crouch = false; //                 пробуем встать прямо под ней
  run(crouching.ps, crouching.cmd, brushes, 2);
  const stuckCrouched = crouching.ps.crouched;
  crouching.cmd.crouch = true;
  run(crouching.ps, crouching.cmd, brushes, 60);
  check(
    'crawl gate',
    standing.ps.origin.z > -680 && crouching.ps.origin.z < -740 && stuckCrouched,
    `standing z=${round(standing.ps.origin.z)} crouched z=${round(crouching.ps.origin.z)} can't stand=${stuckCrouched}`,
  );
}

// ─── Отскок от стены и зацеп ───

/** yaw, при котором смотрим в сторону (dx, dz) («вперёд» = (−sin yaw, 0, −cos yaw)) */
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** Лететь, пока не коснёмся стены (не дольше maxTicks). */
function flyToWall(ps: PlayerState, cmd: UserCmd, world: readonly Brush[], maxTicks = 120) {
  for (let i = 0; i < maxTicks && !ps.wallTouch; i++) run(ps, cmd, world, 1);
}

// Вовремя: врезались (стена справа, x = 100) на 424 u/s — пробел в следующий же тик:
// летим туда, куда смотрим (от стены, вперёд), на 100 быстрее
{
  const { ps, cmd } = fresh(40, 0, yawTo(-0.6, -0.8), 200);
  set(ps.velocity, 300, 0, -300);
  flyToWall(ps, cmd, wallWorld);
  const touched = ps.wallTouch;
  cmd.jump = true;
  run(ps, cmd, wallWorld, 1);
  const v = ps.velocity;
  const speed = lengthXZ(v);
  const along = (v.x * -0.6 + v.z * -0.8) / speed; // 1 — точно куда смотрим
  check(
    'walljump timed',
    touched && Math.abs(speed - (Math.hypot(300, 300) + MOVE.wallJumpBoost)) < 5 && along > 0.99 && v.y > MOVE.wallJumpVelocity - 20,
    `speed=${round(speed)} (было 424) direction match=${round(along)} up=${round(v.y)}`,
  );
}

// Не вовремя (через 0.25 с скольжения по стене): обычный отскок — от стены 280, вдоль — как летели, без ускорения
{
  const { ps, cmd } = fresh(40, 0, yawTo(-0.6, -0.8), 200);
  set(ps.velocity, 300, 0, -300);
  flyToWall(ps, cmd, wallWorld);
  run(ps, cmd, wallWorld, 15);
  const stillTouching = ps.wallTouch;
  cmd.jump = true;
  run(ps, cmd, wallWorld, 1);
  const v = ps.velocity;
  check(
    'walljump late',
    stillTouching && Math.abs(v.x + MOVE.wallJumpPush) < 1 && lengthXZ(v) < 424,
    `v=(${round(v.x)}, ${round(v.z)}) speed=${round(lengthXZ(v))}`,
  );
}

// Три отскока за полёт: A → B → A → (на B четвёртый раз стена уже не ловит). На земле — снова можно
{
  const corridor = [
    ...flat,
    boxBrush(vec3(100, 0, -5000), vec3(116, 2000, 5000), 0), //   стена A (справа)
    boxBrush(vec3(-276, 0, -5000), vec3(-260, 2000, 5000), 0), // стена B (слева), между ними 360
  ];
  const { ps, cmd } = fresh(40, 0, 0, 700);
  set(ps.velocity, 300, 0, -300);
  let touches = 0;
  let reachedFourth = false;
  for (let i = 0; i < 600 && !ps.onGround; i++) {
    // Сразу после касания: смотрим наискосок к другой стене и жмём пробел (свежее нажатие)
    const wasJump = cmd.jump;
    cmd.jump = false;
    if (ps.wallTouch && !wasJump) {
      cmd.yaw = yawTo(ps.wallNormal.x * 0.6, -0.8);
      cmd.jump = true;
    }
    const before = ps.wallTouch;
    run(ps, cmd, corridor, 1);
    if (ps.wallTouch && !before) touches++;
    if (ps.wallJumps === 3 && ps.origin.x < -260 + 17) reachedFourth = true; // снова у стены B
  }
  const jumps = ps.wallJumps;
  run(ps, cmd, corridor, 1); // тик на земле — счётчик обнуляется
  check(
    'walljumps 3 per air',
    touches === 3 && jumps === 3 && reachedFourth && ps.wallJumps === 0,
    `touches=${touches} walljumps=${jumps} 4th wall reached=${reachedFourth} after landing=${ps.wallJumps}`,
  );
}

// ─── Зоны ───

// Джамп-пад: просто стоять на нём — ничего; прыжок с него — на 550 вверх
{
  const { ps, cmd } = fresh(0, 160, 0, 2);
  run(ps, cmd, brushes, 60);
  const idleY = ps.origin.y;
  cmd.jump = true;
  let apex = 0;
  run(ps, cmd, brushes, 1);
  cmd.jump = false;
  run(ps, cmd, brushes, 120, () => (apex = Math.max(apex, ps.origin.y)));
  const rise = apex - idleY;
  check('jump pad', Math.abs(idleY - 30.125) < 1 && Math.abs(rise - 550) < 10, `standing y=${round(idleY)} jump rise=${round(rise)} (цель 550)`);
}

// Разбег на север, прыжок с пада: летим туда же, куда бежали (W в полёте отпущена), — и долетаем
// до высокой плиты (верх 288, z от −640 до −384)
{
  const { ps, cmd } = fresh(0, 330, 0, 0);
  cmd.forward = 1;
  while (ps.onGround || ps.origin.z > 300) {
    cmd.jump = ps.origin.z < 208 + 16; // прыгаем, как только встали на пад
    run(ps, cmd, brushes, 1);
  }
  Object.assign(cmd, { forward: 0, jump: false });
  const vx = Math.abs(ps.velocity.x);
  run(ps, cmd, brushes, 150);
  const onPlate = ps.onGround && Math.abs(ps.origin.y - (288 + PLAYER.halfExtents.y + 0.125)) < 1;
  check(
    'jump pad keeps direction',
    onPlate && ps.origin.z < -400 && ps.origin.z > -620 && vx < 1,
    `landed y=${round(ps.origin.y)} z=${round(ps.origin.z)} sideways=${round(vx)}`,
  );
}

// Бустер: стоим в полосе — разгоняет на восток
{
  const { ps, cmd } = fresh(-150, 800, EAST, 2);
  run(ps, cmd, brushes, 30);
  check('booster', ps.velocity.x > 700, `speed=${round(lengthXZ(ps.velocity))}`);
}
