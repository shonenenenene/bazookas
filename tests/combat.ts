// Проверки боя: рокет-джамп каждой базукой, баллистика (недолёт / попадание), дуга миномёта,
// веер Spam Can, перезарядка, 20 секунд песочницы с манекенами без вылетов.

import { TICK_DT } from '../src/shared/config';
import { testMap } from '../src/shared/maps/testMap';
import { vec3 } from '../src/shared/math';
import { type GameEvent, type World, addPlayer, createWorld, worldTick } from '../src/shared/world';
import { check, round } from './check';

const DEG = Math.PI / 180;
const noDummies = { ...testMap, dummies: [] };

/** Забрать накопившиеся события мира */
function collect(w: World): GameEvent[] {
  const events = [...w.events];
  w.events.length = 0;
  return events;
}

function ticks(w: World, n: number, each?: (events: GameEvent[]) => void) {
  for (let i = 0; i < n; i++) {
    worldTick(w, TICK_DT);
    const events = collect(w);
    each?.(events);
  }
}

console.log('\n── бой ──');

// Рокет-джамп: смотрим вниз, прыжок + выстрел в один тик. [базука, минимальная высота]
for (const [weapon, minHeight] of [[0, 150], [1, 200], [2, 60], [3, 100]]) {
  const w = createWorld(noDummies);
  const me = addPlayer(w, 'me', { feet: vec3(-600, 0, 0), yaw: 0 });
  ticks(w, 20);
  const baseY = me.state.origin.y;
  Object.assign(me.cmd, { weapon, pitch: -89 * DEG, jump: true, fire: true });
  ticks(w, 1);
  Object.assign(me.cmd, { jump: false, fire: false });
  let height = 0;
  ticks(w, 180, () => (height = Math.max(height, me.state.origin.y - baseY)));
  check(`rocket jump #${weapon + 1}`, height > minHeight && !me.dead, `height=${round(height)} hp=${round(me.health)}`);
}

// Баллистика: Ol' Reliable по манекену в 750 юнитах. Ровный прицел — недолёт, +4.3° — прямое попадание
for (const [pitch, expectHit] of [[0, false], [4.3, true]] as const) {
  const w = createWorld({ ...testMap, dummies: [testMap.dummies[0]] });
  const me = addPlayer(w, 'me', testMap.spawns[0]);
  const dummy = w.players.find((p) => p.name === 'xX_n00b_Xx')!;
  ticks(w, 20);
  Object.assign(me.cmd, { pitch: pitch * DEG, fire: true });
  const all: GameEvent[] = [];
  ticks(w, 1, (e) => all.push(...e));
  me.cmd.fire = false;
  ticks(w, 90, (e) => all.push(...e));
  const ex = all.find((e) => e.type === 'explode');
  const killed = all.some((e) => e.type === 'kill');
  const exZ = ex?.type === 'explode' ? ex.pos.z : NaN;
  const ok = expectHit ? killed && dummy.dead : !killed && exZ > dummy.spawn!.feet.z + 20;
  check(`ballistics pitch=${pitch}°`, ok, `explode z=${round(exZ)} dummyHP=${round(dummy.health)}`);
}

// Миномёт под 45°: дальность ~1000, высокая дуга
{
  const w = createWorld(noDummies);
  const me = addPlayer(w, 'me', { feet: vec3(-600, 0, 0), yaw: -Math.PI / 2 });
  ticks(w, 20);
  Object.assign(me.cmd, { weapon: 1, pitch: 45 * DEG, fire: true });
  ticks(w, 1);
  me.cmd.fire = false;
  let apex = 0;
  let landX = NaN;
  for (let i = 0; i < 300 && Number.isNaN(landX); i++) {
    ticks(w, 1, (events) => {
      for (const e of events) if (e.type === 'explode') landX = e.pos.x;
    });
    for (const r of w.rockets) apex = Math.max(apex, r.pos.y);
  }
  const range = landX + 600;
  check('mortar arc', range > 900 && range < 1150 && apex > 200, `range=${round(range)} apex=${round(apex)}`);
}

// Spam Can: три ракеты за выстрел, и перезарядка не даёт выстрелить сразу снова
{
  const w = createWorld(noDummies);
  const me = addPlayer(w, 'me', testMap.spawns[0]);
  Object.assign(me.cmd, { weapon: 3, fire: true });
  ticks(w, 1);
  check('spam can', w.rockets.length === 3, `rockets=${w.rockets.length}`);
  ticks(w, 1);
  check('reload', w.rockets.length === 3, `rockets=${w.rockets.length} cooldown=${round(me.cooldown)}`);
}

// 20 секунд песочницы: стреляем себе под ноги, манекены бегают — никто не улетает за карту
{
  const w = createWorld(testMap);
  const me = addPlayer(w, 'me', testMap.spawns[0]);
  Object.assign(me.cmd, { pitch: -89 * DEG, fire: true });
  let kills = 0;
  ticks(w, 1200, (events) => (kills += events.filter((e) => e.type === 'kill').length));
  const escaped = w.players.filter(
    (p) => !p.dead && (Math.abs(p.state.origin.x) > 1024 || Math.abs(p.state.origin.z) > 1024 || p.state.origin.y < 0),
  );
  check('20s sandbox', escaped.length === 0 && kills > 0, `kills=${kills} escaped=[${escaped.map((p) => p.name)}]`);
}
