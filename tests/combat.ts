// Проверки боя: рокет-джамп, баллистика, хэдшоты и разброс Bazooagle, подрыв по кнопке и ножи Switchblade Serenade,
// отскоки и гранатки Bouncy Castle, смертельный во всём радиусе взрыв Breakdown Mortar, перезарядка,
// 20 секунд песочницы с манекенами без вылетов.

import { splashDamage } from '../src/shared/combat';
import { TICK_DT } from '../src/shared/config';
import { testMap } from '../src/shared/maps/testMap';
import { vec3 } from '../src/shared/math';
import { WEAPONS, weaponIndex } from '../src/shared/weapons';
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
// (Desert Bazooagle и Switchblade Serenade без урона взрывом — рокет-джампа нет; Bouncy Castle отскакивает
// от пола — тоже не для джампа)
for (const [weapon, minHeight] of [[0, 150], [4, 250]]) {
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

// Баллистика Ol': ракета быстрая (1600) — по манекену в 750 юнитах ровный прицел попадает;
// но дуга есть: за 0.5 с полёта ракета опускается на ~20 (за 1 с — на ~80; гравитация 0.2)
{
  const w = createWorld({ ...testMap, dummies: [testMap.dummies[0]] });
  const me = addPlayer(w, 'me', testMap.spawns[0]);
  const dummy = w.players.find((p) => p.name === 'xX_n00b_Xx')!;
  ticks(w, 20);
  Object.assign(me.cmd, { pitch: 0, fire: true });
  ticks(w, 1);
  me.cmd.fire = false;
  ticks(w, 60);
  check('ballistics flat hit', dummy.dead, `dummyHP=${round(dummy.health)}`);

  const w2 = createWorld(noDummies);
  const me2 = addPlayer(w2, 'me', { feet: vec3(-900, 0, 900), yaw: -Math.PI / 2 }); // вдоль пола на восток
  ticks(w2, 20);
  Object.assign(me2.cmd, { pitch: 0, fire: true });
  ticks(w2, 1);
  me2.cmd.fire = false;
  const y0 = w2.rockets[0].pos.y;
  ticks(w2, 30);
  const drop = y0 - (w2.rockets[0]?.pos.y ?? NaN);
  check('ballistics drop', Math.abs(drop - 20) < 3, `за 0.5 с опустилась на ${round(drop)} (ждём ~20)`);
}

// Desert Bazooagle по манекену в 750 юнитах: прицел на уровне глаз — в голову (наповал), чуть ниже — в тело (−30)
for (const [pitch, head] of [[0, true], [-2, false]] as const) {
  const w = createWorld({ ...testMap, dummies: [testMap.dummies[0]] });
  const me = addPlayer(w, 'me', testMap.spawns[0]);
  const dummy = w.players.find((p) => p.name === 'xX_n00b_Xx')!;
  ticks(w, 20);
  Object.assign(me.cmd, { weapon: 1, pitch: pitch * DEG, fire: true });
  const all: GameEvent[] = [];
  ticks(w, 1, (e) => all.push(...e));
  me.cmd.fire = false;
  ticks(w, 30, (e) => all.push(...e));
  const hit = all.find((e) => e.type === 'damage' && e.targetId === dummy.id);
  const ok = head
    ? dummy.dead && hit?.type === 'damage' && hit.headshot && all.some((e) => e.type === 'kill' && e.headshot)
    : !dummy.dead && dummy.health === 70 && hit?.type === 'damage' && !hit.headshot;
  check(`bazooagle ${head ? 'headshot' : 'body shot'}`, ok, `dummyHP=${round(dummy.health)} headshot=${hit?.type === 'damage' && hit.headshot}`);
}

// Разброс Bazooagle: первая пуля — точно в прицел, следующие (стреляем без пауз) — всё дальше; подождали — снова точно
{
  const w = createWorld(noDummies);
  const me = addPlayer(w, 'me', { feet: vec3(-600, 0, 0), yaw: 0 });
  ticks(w, 20);
  /** Угол между полётом пули и прицелом (смотрим строго на север), градусы */
  const offAim = (v: { x: number; y: number; z: number }) => (Math.acos(-v.z / Math.hypot(v.x, v.y, v.z)) * 180) / Math.PI;
  const shots: number[] = [];
  Object.assign(me.cmd, { weapon: 1, fire: true });
  for (let i = 0; i < 4 * 27 + 1; i++) {
    const before = w.rockets.length;
    ticks(w, 1);
    for (let k = before; k < w.rockets.length; k++) shots.push(offAim(w.rockets[k].vel));
  }
  me.cmd.fire = false;
  ticks(w, 90); // пауза 1.5 с — разброс ушёл (0.45 с перезарядки + 0.9 с на 9°)
  me.cmd.fire = true;
  let after = NaN;
  for (let i = 0; i < 5 && Number.isNaN(after); i++) {
    const before = w.rockets.length;
    ticks(w, 1);
    if (w.rockets.length > before) after = offAim(w.rockets[w.rockets.length - 1].vel);
  }
  const ok = shots[0] < 0.01 && shots.slice(1).every((a) => a > 0.3) && after < 0.01;
  check('bazooagle spread', ok, `shots off aim: ${shots.map((a) => round(a)).join(', ')}° · after pause: ${round(after)}°`);
}

// Bouncy Castle в стену с 300 юнитов: граната отскакивает (летит обратно), взрывается не сразу
{
  const w = createWorld(noDummies);
  const me = addPlayer(w, 'me', { feet: vec3(-600, 0, -700), yaw: 0 }); // северная стена — в 324 впереди
  ticks(w, 20);
  Object.assign(me.cmd, { weapon: 3, pitch: 10 * DEG, fire: true });
  ticks(w, 1);
  me.cmd.fire = false;
  let bounced = false;
  let exploded = false;
  for (let i = 0; i < 200 && !exploded; i++) {
    ticks(w, 1, (events) => (exploded ||= events.some((e) => e.type === 'explode' && e.weapon === 3)));
    for (const r of w.rockets) if (r.weapon === 3 && r.bounces < 2 && r.vel.z > 0) bounced = true; // летит обратно, на юг
  }
  check('bouncy castle', bounced && exploded, `bounced back=${bounced} exploded=${exploded}`);
  // После взрыва — гранатки (5), у каждой один отскок, потом взрыв
  const kid = weaponIndex('bouncelet');
  const kids = w.rockets.filter((r) => r.weapon === kid).length;
  let kidBlasts = 0;
  ticks(w, 150, (events) => (kidBlasts += events.filter((e) => e.type === 'explode' && e.weapon === kid).length));
  const wanted = WEAPONS[3].children!.count;
  check('bouncy castle kids', kids === wanted && kidBlasts === wanted && WEAPONS[kid].bounces === 1, `гранаток ${kids}/${wanted}, взорвалось ${kidBlasts}`);
}

// Switchblade Serenade: выстрел на нажатие; держишь «огонь» — не взрывается; отпустил и нажал над манекеном — взрыв
// (сам не ранит) и дождь из ножей; ножи попадают в манекена — по 10
{
  const w = createWorld({ ...testMap, dummies: [testMap.dummies[0]] });
  const me = addPlayer(w, 'me', testMap.spawns[0]); // манекен xX_n00b_Xx — в 750 к северу
  const dummy = w.players.find((p) => p.name === 'xX_n00b_Xx')!;
  ticks(w, 20);
  const all: GameEvent[] = [];
  Object.assign(me.cmd, { weapon: 2, pitch: 15 * DEG, fire: true }); // навесом — над манекеном пролетит на ~100 выше головы
  ticks(w, 1, (e) => all.push(...e));
  const shell = w.rockets.length === 1 && me.remoteSerial === w.rockets[0].serial;
  const shellNow = () => w.rockets.find((r) => r.weapon === 2);
  ticks(w, 20, (e) => all.push(...e)); // держим — снаряд летит дальше
  const heldOk = w.rockets.length === 1 && !all.some((e) => e.type === 'explode');
  me.cmd.fire = false;
  // Отпускаем и ждём, пока снаряд окажется над манекеном, — жмём: дождь из ножей сверху
  for (let i = 0; i < 120 && (shellNow()?.pos.z ?? -1e9) > dummy.state.origin.z + 20; i++) ticks(w, 1, (e) => all.push(...e));
  const stillFlying = !!shellNow();
  me.cmd.fire = true;
  ticks(w, 1, (e) => all.push(...e));
  const blast = all.filter((e) => e.type === 'explode' && e.weapon === 2).length;
  const knifeList = w.rockets.filter((r) => r.weapon === weaponIndex('switchblade'));
  const knives = knifeList.length;
  const noRefire = me.remoteSerial === -1 && !w.rockets.some((r) => r.weapon === 2);
  me.cmd.fire = false;
  ticks(w, 90, (e) => all.push(...e));
  const knifeHits = all.filter((e) => e.type === 'damage' && e.targetId === dummy.id && e.amount <= 25).length; // 10, в голову 25
  // Взрыв сам не ранит — урон только от ножей (по 10)
  const blastHit = all.some((e) => e.type === 'damage' && e.targetId === dummy.id && e.amount > 25);
  check(
    'switchblade detonate',
    shell && heldOk && stillFlying && blast === 1 && knives === WEAPONS[2].children!.count && noRefire && !blastHit && knifeHits > 0,
    `снаряд=${shell} держим — летит=${heldOk} долетел=${stillFlying} взрывов=${blast} ножей=${knives} повторно не выстрелила=${noRefire} взрыв ранил=${blastHit} ножей попало=${knifeHits}`,
  );
}

// Дождь из ножей: подорвали снаряд высоко в воздухе — все ножи падают вниз (остриём вниз) и втыкаются в пол
// кругом под точкой подрыва: ближе к центру и дальше, а не кольцом
{
  const w = createWorld(noDummies);
  const me = addPlayer(w, 'me', { feet: vec3(-600, 0, 600), yaw: 0 });
  ticks(w, 20);
  Object.assign(me.cmd, { weapon: 2, pitch: 50 * DEG, fire: true });
  ticks(w, 1);
  me.cmd.fire = false;
  ticks(w, 30); // снаряд поднялся
  me.cmd.fire = true;
  const all: GameEvent[] = [];
  ticks(w, 1, (e) => all.push(...e));
  me.cmd.fire = false;
  ticks(w, 150, (e) => all.push(...e));
  const boom = all.find((e) => e.type === 'explode' && e.weapon === 2);
  const knife = weaponIndex('switchblade');
  const landed = all.filter((e) => e.type === 'explode' && e.weapon === knife && !e.expired && !e.hitPlayer);
  const center = boom?.type === 'explode' ? boom.pos : vec3();
  const floorHits = landed.filter((e) => e.type === 'explode' && e.pos.y < 10 && e.dir.y < -0.5); // в пол, остриём вниз
  const dist = floorHits.map((e) => (e.type === 'explode' ? Math.hypot(e.pos.x - center.x, e.pos.z - center.z) : 0));
  const near = dist.filter((d) => d < 150).length;
  const far = dist.filter((d) => d >= 150).length;
  check(
    'switchblade rain',
    boom !== undefined && center.y > 200 && floorHits.length >= 20 && near >= 3 && far >= 3,
    `подрыв на высоте ${round(center.y)}, ножей в пол ${floorHits.length}/${WEAPONS[2].children!.count} (ближе 150: ${near}, дальше: ${far}, до ${round(Math.max(...dist))})`,
  );
}

// Breakdown Mortar: взрыв убивает с полных 100 HP по всему радиусу (380) — и у центра, и у края; за краем — 0.
// Снаряд вдвое больше на экране
{
  const w = createWorld({ ...testMap, dummies: [testMap.dummies[0]] });
  const dummy = w.players.find((p) => p.name === 'xX_n00b_Xx')!;
  const o = dummy.state.origin;
  const at = (d: number) => splashDamage(w, vec3(o.x, o.y, o.z + 16 + d), WEAPONS[4], dummy, vec3()); // d — от края коробки
  const [near, edge, out] = [at(50), at(360), at(400)];
  check('breakdown one-shot', near >= 100 && edge >= 100 && out === 0 && WEAPONS[4].size === 2,
    `урон в 50: ${round(near)}, в 360: ${round(edge)}, в 400: ${round(out)}`);
}

// Перезарядка: Ol' не стреляет снова, пока не перезарядилась
{
  const w = createWorld(noDummies);
  const me = addPlayer(w, 'me', testMap.spawns[0]);
  Object.assign(me.cmd, { weapon: 0, fire: true });
  ticks(w, 2);
  const one = w.rockets.length === 1;
  ticks(w, Math.round(WEAPONS[0].reload * 60));
  check('reload', one && w.rockets.length + w.events.length >= 1 && me.rocketsFired === 2, `ракет выпущено ${me.rocketsFired}`);
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
