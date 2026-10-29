// Проверки карт из TrenchBroom: чтение .map (оси, нормали граней), запись и обратное чтение,
// и что на карте speedway с каждой точки появления можно нормально стоять.

import { readFileSync } from 'node:fs';
import { brushPolygons } from '../src/shared/collision/brush';
import { createTrace, traceBox } from '../src/shared/collision/trace';
import { PLAYER, TICK_DT } from '../src/shared/config';
import { parseMap, writeMap } from '../src/shared/maps/mapFormat';
import { MATERIALS } from '../src/shared/maps/materials';
import { loadMap } from '../src/shared/maps/registry';
import { checkpoint, voidZone } from '../src/shared/maps/triggers';
import { testMap } from '../src/shared/maps/testMap';
import type { GameMap } from '../src/shared/maps/types';
import { type Vec3, cross, dot, lengthXZ, set, sub, vec3 } from '../src/shared/math';
import { playerMove } from '../src/shared/movement';
import { addPlayer, createWorld, worldTick } from '../src/shared/world';
import { createPlayerState, createUserCmd, spawnPlayer } from '../src/shared/player';
import { check, round } from './check';

console.log('── карты ──');

const near = (a: Vec3, b: Vec3, eps = 0.01) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
/** Углы равны с точностью до полного оборота (в .map угол — целые градусы) */
const sameAngle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.01;

/** Сколько граней смотрят внутрь браша (должно быть 0 — иначе грань не видно и столкновения ломаются) */
function badFaces(map: GameMap): number {
  let bad = 0;
  for (const b of map.brushes) {
    // Точка внутри браша — среднее всех вершин (центр габаритов у клина лежит на самом скосе)
    const polys = brushPolygons(b.planes);
    const center = vec3();
    let count = 0;
    for (const p of polys) {
      for (const v of p.points) {
        center.x += v.x;
        center.y += v.y;
        center.z += v.z;
        count++;
      }
    }
    center.x /= count;
    center.y /= count;
    center.z /= count;
    for (const p of polys) {
      if (dot(p.normal, sub(vec3(), p.points[0], center)) <= 0) bad++;
      const [a, b2, c] = p.points;
      const n = cross(vec3(), sub(vec3(), b2, a), sub(vec3(), c, a));
      if (dot(n, p.normal) <= 0) bad++;
    }
  }
  return bad;
}

// ─── Браш, как его сохраняет TrenchBroom: куб 128×128×32 (Quake: Z вверх) в обоих форматах ───
{
  const faces = [
    ['( -64 -64 -16 ) ( -64 -63 -16 ) ( -64 -64 -15 )', '[ 0 -1 0 0 ] [ 0 0 -1 0 ]'],
    ['( -64 -64 -16 ) ( -64 -64 -15 ) ( -63 -64 -16 )', '[ 1 0 0 0 ] [ 0 0 -1 0 ]'],
    ['( -64 -64 -16 ) ( -63 -64 -16 ) ( -64 -63 -16 )', '[ -1 0 0 0 ] [ 0 -1 0 0 ]'],
    ['( 64 64 16 ) ( 64 65 16 ) ( 65 64 16 )', '[ 1 0 0 0 ] [ 0 -1 0 0 ]'],
    ['( 64 64 16 ) ( 65 64 16 ) ( 64 64 17 )', '[ -1 0 0 0 ] [ 0 0 -1 0 ]'],
    ['( 64 64 16 ) ( 64 64 17 ) ( 64 65 16 )', '[ 0 1 0 0 ] [ 0 0 -1 0 ]'],
  ];
  const standard = faces.map(([p]) => `${p} base/crate 0 0 0 1 1`).join('\n');
  const valve = faces.map(([p, uv]) => `${p} crate ${uv} 0 1 1`).join('\n');
  const file = (body: string) => `// Game: The Bazookas
// Format: Valve
{
"classname" "worldspawn"
"message" "tb_test"
// brush 0
{
${body}
}
}
{
"classname" "info_player_deathmatch"
"origin" "100 200 44"
"angle" "180"
}
{
"classname" "trigger_booster"
"angle" "90"
"speed" "700"
// brush 0
{
${body.replaceAll('crate', 'trigger')}
}
}
`;
  for (const [label, body] of [['standard', standard], ['valve220', valve]]) {
    const m = parseMap(file(body), 'x');
    const b = m.brushes[0];
    const s = m.spawns[0];
    const t = m.triggers[0];
    // Quake x −64..64, y −64..64, z −16..16 → наши x −64..64, y −16..16, z −64..64
    const ok = m.name === 'tb_test' && m.brushes.length === 1 && near(b.min, vec3(-64, -16, -64)) && near(b.max, vec3(64, 16, 64)) &&
      b.color === MATERIALS.crate && badFaces(m) === 0 &&
      near(s.feet, vec3(100, 16, -200)) && Math.abs(s.yaw - Math.PI / 2) < 1e-9 && // angle 180 = запад = наш yaw +90°
      t?.type === 'booster' && near(t.dir, vec3(0, 0, -1)) && t.speed === 700; // angle 90 = север = наш −Z
    check(`map parse ${label}`, ok, `min=${JSON.stringify(b.min)} spawn=${JSON.stringify(s.feet)} yaw=${round(s.yaw)}`);
  }
}

// ─── Записали тестовую арену в .map и прочитали обратно — то же самое ───
{
  const back = parseMap(writeMap(testMap), 'x');
  let brushOk = back.brushes.length === testMap.brushes.length;
  testMap.brushes.forEach((b, i) => {
    const c = back.brushes[i];
    if (!c || !near(b.min, c.min) || !near(b.max, c.max) || b.color !== c.color) brushOk = false;
  });
  const spawnsOk = back.spawns.length === testMap.spawns.length &&
    testMap.spawns.every((s, i) => near(s.feet, back.spawns[i].feet) && sameAngle(s.yaw, back.spawns[i].yaw));
  const dummiesOk = testMap.dummies.every((d, i) => back.dummies[i]?.name === d.name && back.dummies[i].bot === d.bot);
  const triggersOk = back.triggers.length === testMap.triggers.length && testMap.triggers.every((t, i) => {
    const u = back.triggers[i];
    if (u.type !== t.type || !near(t.min, u.min) || !near(t.max, u.max)) return false;
    if (t.type === 'jumppad' && u.type === 'jumppad') return Math.abs(t.jumpVelocity - u.jumpVelocity) < 0.01;
    return t.type === 'booster' && u.type === 'booster' && near(t.dir, u.dir) && t.speed === u.speed;
  });
  check(
    'map write → read',
    brushOk && spawnsOk && dummiesOk && triggersOk && back.name === testMap.name && back.fogFar === testMap.fogFar,
    `brushes=${back.brushes.length}/${testMap.brushes.length} spawns=${spawnsOk} dummies=${dummiesOk} triggers=${triggersOk}`,
  );
}

// ─── speedway.map: грани наружу, с каждой точки появления встаём на пол, а не проваливаемся / не застреваем ───
{
  const map = loadMap('speedway', { speedway: readFileSync('assets/maps/speedway.map', 'utf8') });
  const points = [...map.spawns, ...map.dummies.map((d) => d.spawn)];
  let bad = 0;
  for (const sp of points) {
    const ps = createPlayerState();
    spawnPlayer(ps, sp);
    const y = ps.origin.y;
    for (let i = 0; i < 60; i++) playerMove(ps, createUserCmd(), map.brushes, TICK_DT, map.triggers);
    if (!ps.onGround || Math.abs(ps.origin.y - y) > 2) bad++;
  }
  check(
    'speedway spawns',
    map.name === 'speedway' && bad === 0 && badFaces(map) === 0 && map.spawns.length >= 8,
    `brushes=${map.brushes.length} spawns=${map.spawns.length} dummies=${map.dummies.length} bad=${bad}`,
  );
}

// ─── Серф на speedway: с «замка» бустер кидает на склон хребта, держим A — едем по склону всю длину,
// плавно снижаясь дугой (чем дольше едешь, тем круче вниз). Должно получаться и если смотреть не точно вдоль
// хребта (±5° — мёртвая зона взгляда), и с зажатой W. Взгляд в склон — едешь выше, от склона — ниже.
// Потом — отскок от склона пробелом ───
{
  const map = loadMap('speedway', { speedway: readFileSync('assets/maps/speedway.map', 'utf8') });
  const results: string[] = [];
  let ok = true;
  const midY: Record<string, number> = {};
  for (const [look, holdW] of [[0, false], [-0.08, false], [0.08, false], [0, true], [0.2, false], [-0.2, false]] as const) {
    const ps = createPlayerState();
    spawnPlayer(ps, { feet: vec3(-2400, 800, 2250), yaw: 0 }); // на крыше, лицом на север
    const cmd = createUserCmd();
    cmd.forward = 1;
    let touched = false;
    const heightAt: Record<number, number> = {};
    for (let i = 0; i < 400 && ps.origin.z > -1700; i++) {
      if (!ps.onGround && ps.origin.z < 1800) {
        cmd.forward = holdW ? 1 : 0;
        cmd.right = -1; // хребет слева (на западе) — стрейфим в него
        cmd.yaw = look;
      }
      playerMove(ps, cmd, map.brushes, TICK_DT, map.triggers);
      if (ps.origin.z < 1800 && ps.onGround) touched = true;
      for (const mark of [1000, 0, -1000, -1600]) if (ps.origin.z < mark && !(mark in heightAt)) heightAt[mark] = ps.origin.y;
    }
    const [a, b, c, d] = [heightAt[1000], heightAt[0], heightAt[-1000], heightAt[-1600]];
    if (!holdW) midY[look] = b;
    // Доехали до конца, не коснувшись земли; снижаемся; и вторая половина круче первой — дуга
    if (Math.abs(look) < 0.1) ok &&= !touched && d > 60 && a > b && b > c && c > d && c - d > (a - b) * 0.6;
    results.push(`${holdW ? 'W+A' : 'A'} look=${look}: y ${[a, b, c, d].map(round).join('→')}`);
  }
  check('speedway surf', ok, results.slice(0, 4).join(' | '));
  // Хребет слева (на западе): yaw > 0 — смотрим левее, в склон
  check('surf aim', midY[0.2] > midY[0] + 40 && midY[-0.2] < midY[0] - 40,
    `на середине: в склон ${round(midY[0.2])}, вдоль ${round(midY[0])}, от склона ${round(midY[-0.2])}`);

  // Отскок: едем по склону, пробел — летим от склона (на восток) и вверх, скорость вдоль хребта осталась
  const ps = createPlayerState();
  spawnPlayer(ps, { feet: vec3(-2400, 800, 2250), yaw: 0 });
  const cmd = createUserCmd();
  cmd.forward = 1;
  let before = 0;
  for (let i = 0; i < 150; i++) {
    if (!ps.onGround && ps.origin.z < 1800) {
      cmd.forward = 0;
      cmd.right = -1;
    }
    cmd.jump = i === 149;
    if (cmd.jump) before = -ps.velocity.z;
    playerMove(ps, cmd, map.brushes, TICK_DT, map.triggers);
  }
  const v = ps.velocity;
  check('surf jump', v.x > 250 && v.y > 100 && -v.z > before + 30, `away=${round(v.x)} up=${round(v.y)} along ${round(before)}→${round(-v.z)}`);
}

// ─── Пады у «замка»: встал на пад, прыжок + W к замку — оказываешься на крыше (ноги на 800) ───
{
  const map = loadMap('speedway', { speedway: readFileSync('assets/maps/speedway.map', 'utf8') });
  const castle = { x: -2100, z: 2100 };
  const pads = map.triggers.filter((t) => t.type === 'jumppad' && t.height === 1000);
  let ok = 0;
  for (const pad of pads) {
    const x = (pad.min.x + pad.max.x) / 2;
    const z = (pad.min.z + pad.max.z) / 2;
    const yaw = Math.atan2(-(castle.x - x), -(castle.z - z)); // «вперёд» = (−sin yaw, −cos yaw) — к центру замка
    const ps = createPlayerState();
    spawnPlayer(ps, { feet: vec3(x, 2, z), yaw });
    const cmd = createUserCmd();
    cmd.yaw = yaw;
    for (let i = 0; i < 240; i++) {
      cmd.jump = i === 10;
      cmd.forward = i >= 10 ? 1 : 0;
      playerMove(ps, cmd, map.brushes, TICK_DT, map.triggers);
      if (ps.onGround && ps.origin.y > 790 + 28) {
        ok++;
        break;
      }
    }
  }
  check('speedway castle pads', pads.length === 6 && ok === pads.length, `pads=${pads.length} onto roof=${ok}`);
}

// ─── sky_surf: кольцо. Манекены стоят, чекпоинтов нет, круг проходится «как человек», пустота убивает;
// катапульта с финиша закидывает на старт ───
{
  const map = loadMap('sky_surf', { sky_surf: readFileSync('assets/maps/sky_surf.map', 'utf8') });
  let bad = 0;
  for (const sp of [...map.spawns, ...map.dummies.map((d) => d.spawn)]) {
    const ps = createPlayerState();
    spawnPlayer(ps, sp);
    const y = ps.origin.y;
    for (let i = 0; i < 60; i++) playerMove(ps, createUserCmd(), map.brushes, TICK_DT, map.triggers);
    if (!ps.onGround || Math.abs(ps.origin.y - y) > 2) bad++;
  }
  const cps = map.triggers.filter((t) => t.type === 'checkpoint').length;
  check(
    'sky_surf map',
    bad === 0 && badFaces(map) === 0 && map.dummies.length >= 20 && cps === 0 && map.sky === 'space',
    `brushes=${map.brushes.length} dummies=${map.dummies.length} (не стоят: ${bad}) checkpoints=${cps}`,
  );

  // Круг: смотрим по ходу, держим клавишу в сторону склона, сползаем — доворачиваем взгляд в склон;
  // с другой стороны, недалеко, показался соседний хребет — пробел и другая клавиша
  const world = createWorld(map, { dummies: false });
  const me = addPlayer(world, 'you', null);
  world.events.length = 0;
  const tr = createTrace();
  const end = vec3();
  const probe = (dx: number, dz: number, dist = 300, down = 150) => {
    const o = me.state.origin;
    set(end, o.x + dx * dist, o.y - down, o.z + dz * dist);
    traceBox(tr, map.brushes, o, end, PLAYER.halfExtents);
    return tr.fraction < 1 ? tr.fraction : 2;
  };
  let airYaw = 0;
  let lock = 0;
  let locked = 0;
  let respawns = 0;
  let jumps = 0;
  let finished = -1;
  for (let i = 0; i < 60 * 80 && finished < 0; i++) {
    const s = me.state;
    const c = me.cmd;
    const v = s.velocity;
    const onRamp = s.surfTime > 0;
    if (lengthXZ(v) > 200 && (onRamp || s.onGround)) c.yaw = airYaw = Math.atan2(-v.x, -v.z);
    if (!onRamp && !s.onGround) c.yaw = airYaw;
    c.jump = false;
    c.forward = s.onGround ? 1 : 0;
    c.right = 0;
    if (!s.onGround) {
      const rx = Math.cos(c.yaw);
      const rz = -Math.sin(c.yaw);
      const r = probe(rx, rz);
      const l = probe(-rx, -rz);
      if (lock > 0) {
        lock = lock > 140 || !onRamp ? lock - 1 : 0; // держим новую клавишу, пока не сели на склон
        c.right = locked;
      } else if (r < 2 || l < 2) c.right = r < l ? 1 : -1;
      if (onRamp && c.right !== 0 && lock === 0) c.yaw -= c.right * Math.max(-0.3, Math.min(0.35, (-v.y - 15) / 150));
      // От склона в сторону, в 900 — соседний хребет? Прыгаем на него и держим другую клавишу
      if (onRamp && lock === 0 && s.surfTime > 0.3 && c.right !== 0 && probe(-c.right * rx, -c.right * rz, 900, 250) < 2) {
        c.jump = true;
        jumps++;
        locked = -c.right;
        lock = 150;
      }
    }
    worldTick(world, TICK_DT);
    for (const e of world.events) if (e.type === 'spawn') respawns++;
    world.events.length = 0;
    if (s.onGround && s.origin.y < 500) finished = i / 60; // встали на финишную площадку (она внизу, у катапульты)
  }
  check('sky_surf lap', finished > 0 && respawns === 0 && jumps === 4, `круг за ${round(finished)} с, падений ${respawns}, отскоков ${jumps}`);

  // Катапульта: встал на неё, прыжок и W на север — приземляешься на стартовой площадке
  const pad = map.triggers.find((t) => t.type === 'jumppad')!;
  const ps = createPlayerState();
  spawnPlayer(ps, { feet: vec3((pad.min.x + pad.max.x) / 2, pad.min.y, (pad.min.z + pad.max.z) / 2), yaw: 0 });
  const cmd = createUserCmd();
  let landedY = 0;
  for (let i = 0; i < 60 * 8 && !landedY; i++) {
    cmd.jump = i === 10;
    cmd.forward = i >= 10 ? 1 : 0;
    playerMove(ps, cmd, map.brushes, TICK_DT, map.triggers);
    if (i > 30 && ps.onGround) landedY = ps.origin.y - PLAYER.halfExtents.y;
  }
  const startY = map.spawns[0].feet.y;
  check('sky_surf catapult', Math.abs(landedY - startY) < 3, `прыгнул с ${round(pad.min.y)} — встал на ${round(landedY)} (старт ${startY})`);

  // Пустота на карте без чекпоинтов: упал — погиб (и потом появится на старте)
  const w2 = createWorld(map, { dummies: false });
  const p = addPlayer(w2, 'you', null);
  const deep = map.triggers.find((t) => t.type === 'void')!;
  set(p.state.origin, (deep.min.x + deep.max.x) / 2, deep.max.y - 100, (deep.min.z + deep.max.z) / 2);
  w2.events.length = 0;
  worldTick(w2, TICK_DT);
  check('sky_surf void kills', p.dead && w2.events.some((e) => e.type === 'kill' && e.targetId === p.id), `погиб=${p.dead}`);
}

// ─── Чекпоинты (на мини-карте): пролетел зону — упал в пустоту — сразу на ней, без смерти и со скоростью; манекен гибнет ───
{
  const cp = checkpoint(vec3(-100, 0, -100), vec3(100, 200, 100), 0, false, { feet: vec3(0, 0, 600), yaw: 0, speed: 900 });
  const pit = voidZone(vec3(-2000, -500, 1500), vec3(2000, -100, 2500));
  const map = { ...testMap, triggers: [...testMap.triggers, cp, pit] };
  const w = createWorld(map, { dummies: false });
  const p = addPlayer(w, 'you', null);
  const bot = addPlayer(w, 'dummy', testMap.spawns[0], 'idle');
  set(p.state.origin, 0, 30, 0); // в зоне чекпоинта
  worldTick(w, TICK_DT);
  for (const q of [p, bot]) set(q.state.origin, 0, -300, 2000); // в пустоте
  w.events.length = 0;
  worldTick(w, TICK_DT);
  const kills = w.events.filter((e) => e.type === 'kill');
  const ok = cp.type === 'checkpoint' && p.checkpoint === cp.spawn && !p.dead && Math.abs(p.state.origin.z - 600) < 20 && lengthXZ(p.state.velocity) > 800 &&
    bot.dead && kills.length === 1 && kills[0].type === 'kill' && kills[0].targetId === bot.id;
  check('void → checkpoint', ok, `игрок жив=${!p.dead} z=${round(p.state.origin.z)} скорость=${round(lengthXZ(p.state.velocity))} манекен погиб=${bot.dead}`);
}
