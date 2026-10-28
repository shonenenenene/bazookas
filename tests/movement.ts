// Проверки движения: бег, трение, прыжок, стены, ступеньки, рампы, разгон стрейфами, серф.
// Гоняем физику без браузера на тестовой арене.

import { brushPolygons } from '../src/shared/collision/brush';
import { TICK_DT } from '../src/shared/config';
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

// Банни-хоп со стрейфом: держим «вправо» перпендикулярно скорости — скорость должна расти выше 320
{
  const { ps, cmd } = fresh(-700, 900, 0);
  cmd.forward = 1;
  run(ps, cmd, 30);
  cmd.forward = 0;
  cmd.right = 1;
  cmd.jump = true;
  let top = 0;
  run(ps, cmd, 180, () => {
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
