// Собирает стартовые карты кодом и выгружает в assets/maps/*.map — дальше их можно править в TrenchBroom.
// Запуск: npm run maps:generate. Уже существующий файл НЕ перезаписывается (там могут быть твои правки
// из редактора); перегенерировать насильно — npm run maps:generate -- --force.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { type Brush, type Plane, type RampRise, boxBrush, boxPlanes, makeBrush, rampBrush } from '../src/shared/collision/brush';
import { type Vec3, cross, dot, normalize, scale, sub, vec3 } from '../src/shared/math';
import { writeMap } from '../src/shared/maps/mapFormat';
import { MATERIALS } from '../src/shared/maps/materials';
import { booster, jumpPad, voidZone } from '../src/shared/maps/triggers';
import type { DummySpawn, GameMap, Trigger } from '../src/shared/maps/types';

const force = process.argv.includes('--force');

function box(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, mat: string): Brush {
  return boxBrush(vec3(x1, y1, z1), vec3(x2, y2, z2), MATERIALS[mat]);
}
function ramp(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, rise: RampRise, mat: string): Brush {
  return rampBrush(vec3(x1, y1, z1), vec3(x2, y2, z2), rise, MATERIALS[mat]);
}

/** Плоскость через три точки, нормалью наружу — от точки inside. */
function plane3(p: Vec3, q: Vec3, r: Vec3, inside: Vec3): Plane {
  const n = cross(vec3(), sub(vec3(), q, p), sub(vec3(), r, p));
  normalize(n, n);
  let d = dot(n, p);
  if (dot(n, inside) > d) {
    scale(n, n, -1);
    d = -d;
  }
  return { normal: n, dist: d };
}

// ─── speedway: большая арена 6144×6144 под скорость ───────────
// Оси как в игре: Y вверх, север — это −Z. Пол на y = 0.

function speedway(): GameMap {
  const b: Brush[] = [];
  const t: Trigger[] = [];

  // Пол и стены (1024 в высоту — для рокет-джампов)
  b.push(box(-3072, -64, -3072, 3072, 0, 3072, 'floor'));
  b.push(box(-3136, -64, -3136, 3136, 1024, -3072, 'wall')); // север
  b.push(box(-3136, -64, 3072, 3136, 1024, 3136, 'wall')); //   юг
  b.push(box(-3136, -64, -3072, -3072, 1024, 3072, 'wall')); // запад
  b.push(box(3072, -64, -3072, 3136, 1024, 3072, 'wall')); //   восток

  // Края карты (640 от стен) — пустые дорожки для бхопа. На юге и севере — бустеры навстречу друг другу,
  // в конце — трамплин в стену: вылетаешь и отскакиваешь от неё
  b.push(box(-2300, 0, 2700, 2300, 2, 2860, 'booster'));
  t.push(booster(vec3(-2300, 2, 2700), vec3(2300, 40, 2860), 1, 0, 950, 6000)); //    юг → на восток
  b.push(ramp(2420, 0, 2620, 2860, 200, 2940, '+x', 'ramp'));
  b.push(box(-2300, 0, -2860, 2300, 2, -2700, 'booster'));
  t.push(booster(vec3(-2300, 2, -2860), vec3(2300, 40, -2700), -1, 0, 950, 6000)); // север → на запад
  b.push(ramp(-2860, 0, -2940, -2420, 200, -2620, '-x', 'ramp'));

  // Запад — серф: два высоких хребта (768) по 3600 в длину, склоны ~63° — стоять нельзя, только скользить.
  // Хребет должен быть высоким: падаешь на склон — тебя тянет вниз, и пока стрейф это не погасит, теряешь высоту.
  // Старт — «замок» высотой 800 на юге: на крышу — джамп-пад, по крыше бустер на север — слетаешь прямо на склоны
  for (const cx of [-2500, -1650]) {
    b.push(ramp(cx - 384, 0, -1800, cx, 768, 1800, '+x', 'surf'));
    b.push(ramp(cx, 0, -1800, cx + 384, 768, 1800, '-x', 'surf'));
  }
  b.push(box(-2900, 0, 1900, -1300, 800, 2300, 'platform'));
  b.push(box(-2900, 800, 1900, -1300, 802, 2100, 'booster'));
  t.push(booster(vec3(-2900, 802, 1900), vec3(-1300, 840, 2100), 0, -1, 800, 6000)); // на север
  // Пады на крышу — с юга, востока и запада (с севера — хребты), чтобы не оббегать замок.
  // Прыжок на 1000 — запас по времени: с пада летишь в стену замка, а над крышей успеваешь долететь на неё с W
  for (const [x, z] of [[-2600, 2380], [-2100, 2380], [-1600, 2380], [-1220, 1990], [-1220, 2210], [-2980, 2100]]) {
    b.push(box(x - 50, 0, z - 40, x + 50, 2, z + 40, 'pad'));
    t.push(jumpPad(vec3(x - 50, 2, z - 40), vec3(x + 50, 32, z + 40), 1000));
  }

  // Центр — башня в три этажа (256, 512, 768): колонны, площадки, пады; рампа на первый этаж с запада
  b.push(box(-448, 240, -448, 448, 256, 448, 'platform'));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.push(box(Math.min(sx * 384, sx * 448), 0, Math.min(sz * 384, sz * 448), Math.max(sx * 384, sx * 448), 240, Math.max(sz * 384, sz * 448), 'bone'));
      b.push(box(Math.min(sx * 208, sx * 256), 256, Math.min(sz * 208, sz * 256), Math.max(sx * 208, sx * 256), 496, Math.max(sz * 208, sz * 256), 'bone'));
    }
  }
  b.push(box(-256, 496, -256, 256, 512, 256, 'platform'));
  b.push(box(-24, 512, -24, 24, 752, 24, 'bone'));
  b.push(box(-96, 752, -96, 96, 768, 96, 'accent')); // «корона» — для кемперов и рокет-джамперов
  b.push(ramp(-890, 0, -64, -448, 256, 64, '+x', 'ramp'));
  // Пады: с земли на 1-й этаж (разбегись на север), с 1-го на 2-й, со 2-го на корону
  b.push(box(-48, 0, 560, 48, 2, 656, 'pad'));
  t.push(jumpPad(vec3(-48, 2, 560), vec3(48, 32, 656), 420));
  b.push(box(-48, 256, 360, 48, 258, 440, 'pad'));
  t.push(jumpPad(vec3(-48, 258, 360), vec3(48, 288, 440), 400));
  b.push(box(-40, 512, 160, 40, 514, 240, 'pad'));
  t.push(jumpPad(vec3(-40, 514, 160), vec3(40, 544, 240), 380));

  // Восток — терраса на высоте 256: мост с 1-го этажа башни и рампа с земли
  b.push(box(1408, 0, -512, 2048, 256, 512, 'wall'));
  b.push(box(448, 240, -64, 1408, 256, 64, 'accent'));
  b.push(ramp(2048, 0, -64, 2420, 256, 64, '-x', 'ramp'));

  // Северо-восток — коридор из трёх стен для отскоков (между ними по 240), в конце — площадка
  for (const x of [1200, 1456, 1712]) b.push(box(x, 0, -2300, x + 16, 512, -1300, 'wallrun'));
  b.push(box(1200, 0, -2400, 1728, 192, -2300, 'platform'));

  // Юго-восток — фанбокс: площадка высотой 96 с рампами со всех сторон
  b.push(box(1200, 0, 1200, 1800, 96, 1800, 'platform'));
  b.push(ramp(1200, 0, 1020, 1800, 96, 1200, '+z', 'ramp'));
  b.push(ramp(1200, 0, 1800, 1800, 96, 1980, '-z', 'ramp'));
  b.push(ramp(1020, 0, 1200, 1200, 96, 1800, '+x', 'ramp'));
  b.push(ramp(1800, 0, 1200, 1980, 96, 1800, '-x', 'ramp'));

  // Северо-запад — «собор»: четыре колонны и алтарь на высоте 464; пад южнее (лети на север)
  for (const cx of [-1100, -700]) {
    for (const cz of [-1700, -1300]) b.push(box(cx - 64, 0, cz - 64, cx + 64, 448, cz + 64, 'bone'));
  }
  b.push(box(-1164, 448, -1764, -636, 464, -1236, 'blood'));
  b.push(box(-948, 0, -1040, -852, 2, -960, 'pad'));
  t.push(jumpPad(vec3(-948, 2, -1040), vec3(-852, 32, -960), 600));

  // Укрытия в поле: ящики, низкие стенки, колонны
  for (const [x, z] of [[-900, 600], [-700, 900], [700, -900], [900, 700], [-400, 1300], [500, 1400], [1300, 300]]) {
    b.push(box(x - 64, 0, z - 64, x + 64, 128, z + 64, 'crate'));
  }
  b.push(box(-160, 0, 880, 160, 96, 912, 'wall'));
  b.push(box(-160, 0, -912, 160, 96, -880, 'wall'));
  b.push(box(-1032, 0, -160, -1000, 96, 160, 'wall'));
  for (const [x, z] of [[800, -1100], [800, 1100], [-700, 1100]]) b.push(box(x - 32, 0, z - 32, x + 32, 256, z + 32, 'bone'));

  const deg = Math.PI / 180;
  return {
    name: 'speedway',
    description: 'big arena 4 speed: bhop lanes w/ boosters, surf ridges, a 3-floor tower, walljump alley',
    preview: { eye: vec3(2750, 1350, 2750), yaw: Math.PI / 4, pitch: -0.36 }, // с юго-восточного угла, сверху
    brushes: b,
    triggers: t,
    // yaw: 0 — смотрим на север (−Z), 90° — на запад, −90° — на восток, 180° — на юг
    spawns: [
      { feet: vec3(300, 0, 1150), yaw: 0 },
      { feet: vec3(0, 0, -1100), yaw: 180 * deg },
      { feet: vec3(0, 0, 2100), yaw: 0 },
      { feet: vec3(-2500, 0, -2200), yaw: -90 * deg },
      { feet: vec3(2750, 0, 0), yaw: 90 * deg },
      { feet: vec3(-2750, 0, 2750), yaw: -45 * deg },
      { feet: vec3(2750, 0, -2750), yaw: 135 * deg },
      { feet: vec3(1728, 256, 0), yaw: 90 * deg },
    ],
    dummies: [
      { name: 'bhop_andy', spawn: { feet: vec3(0, 0, 1600), yaw: 0 }, bot: 'bhop' },
      { name: 'strafe_lord', spawn: { feet: vec3(-600, 0, 300), yaw: 180 * deg }, bot: 'strafe' },
      { name: 'camper_2004', spawn: { feet: vec3(0, 768, 0), yaw: 180 * deg }, bot: 'idle' },
      { name: 'ur_mom', spawn: { feet: vec3(1800, 256, 300), yaw: 90 * deg }, bot: 'idle' },
      { name: 'surf_nerd', spawn: { feet: vec3(-2100, 800, 2220), yaw: 0 }, bot: 'idle' }, //   на «замке», у бустера
      { name: 'myspace_tom', spawn: { feet: vec3(-900, 464, -1500), yaw: 180 * deg }, bot: 'idle' }, // на алтаре
      { name: 'bridge_troll', spawn: { feet: vec3(900, 256, 0), yaw: 180 * deg }, bot: 'strafe' }, //  бегает по мосту
      { name: 'tower_kid', spawn: { feet: vec3(0, 256, -330), yaw: 180 * deg }, bot: 'strafe' }, //   1-й этаж башни
      { name: 'pillar_goth', spawn: { feet: vec3(800, 256, -1100), yaw: 180 * deg }, bot: 'idle' }, // на колонне
      { name: 'wall_hugger', spawn: { feet: vec3(1460, 192, -2350), yaw: 180 * deg }, bot: 'idle' }, // конец коридора
      { name: 'xXx_sk8r_xXx', spawn: { feet: vec3(1500, 96, 1500), yaw: 0 }, bot: 'bhop' }, //       фанбокс
      { name: 'emo_kid_99', spawn: { feet: vec3(600, 0, 2500), yaw: 0 }, bot: 'strafe' }, //          у южной дорожки
      { name: 'lane_ghost', spawn: { feet: vec3(0, 0, -2450), yaw: 90 * deg }, bot: 'bhop' }, //      у северной дорожки
      { name: 'chug_lord', spawn: { feet: vec3(1500, 256, -400), yaw: 90 * deg }, bot: 'idle' }, //   на террасе
    ],
    skyColor: 0x0d0612,
    fogNear: 600,
    fogFar: 4500, // большая карта — видно дальше (геометрии мало, слабым ПК не тяжело)
  };
}

// ─── sky_surf: серф-кольцо в космосе ──────────────────────────
// Трасса — кольцо из хребтов: четыре прямых и четыре поворота направо, ~37000 юнитов. Весь круг она понемногу
// спускается (разгоняет), поэтому финиш — под стартом, а «катапульта» (джамп-пад) закидывает обратно наверх.
// На прямых — переходы: «разрыв» (следующий хребет ниже, перелетаешь) и «отскок» (следующий стоит рядом
// параллельно — прыгаешь на него пробелом и меняешь клавишу). Повороты — цепочка коротких хребтов со скошенными
// стыками. Под трассой — пустота: упал — погиб и снова на старте.
// Снаружи кольца — столбы и балконы с манекенами. На старте — готические ворота, в небе — космос и кровавая луна.

/** Горизонтальное направление (x, z) длины 1 */
type Dir = { x: number; z: number };
const rotate = (d: Dir, a: number): Dir => ({ x: d.x * Math.cos(a) - d.z * Math.sin(a), z: d.x * Math.sin(a) + d.z * Math.cos(a) });
/** Вправо от направления (повороты трассы — направо, «внутрь» кольца) */
const rightOf = (d: Dir): Dir => ({ x: -d.z, z: d.x });
/** yaw, при котором смотришь в сторону d: «вперёд» = (−sin yaw, −cos yaw) */
const yawOf = (d: Dir) => Math.atan2(-d.x, -d.z);

/** Выпуклый многоугольник в плоскости XY (точки по кругу), вытянутый по Z от z1 до z2 — для ворот. */
function prismXY(points: [number, number][], z1: number, z2: number, mat: string): Brush {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const inside = vec3(cx, cy, (z1 + z2) / 2);
  const planes: Plane[] = [plane3(vec3(0, 0, z1), vec3(1, 0, z1), vec3(0, 1, z1), inside), plane3(vec3(0, 0, z2), vec3(1, 0, z2), vec3(0, 1, z2), inside)];
  points.forEach(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    planes.push(plane3(vec3(x, y, z1), vec3(nx, ny, z1), vec3(x, y, z2), inside));
  });
  return withBevels(planes, mat);
}

/** Браш из плоскостей + фаски (плоскости габаритной коробки, если такой грани ещё нет) — для столкновений. */
function withBevels(planes: Plane[], mat: string): Brush {
  const brush = makeBrush(planes, MATERIALS[mat]);
  for (const bevel of boxPlanes(brush.min, brush.max)) {
    if (!planes.some((p) => dot(p.normal, bevel.normal) > 0.9999)) planes.push(bevel);
  }
  return brush;
}

/**
 * Серф-хребет: треугольная «крыша» с гребнем от a (высота topA) до b (topB). half — полуширина основания,
 * h — высота сечения (h = 2·half → склоны ~63°). Торцы: startCap / endCap — нормали наружу (по горизонтали);
 * на стыке двух хребтов они скошены по биссектрисе, и склоны сходятся без щели.
 */
function ridgeSeg(a: Dir, b: Dir, topA: number, topB: number, half: number, h: number, startCap: Dir, endCap: Dir, mat: string): Brush {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const d = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  const r = rightOf(d);
  const A = vec3(a.x, topA, a.z);
  const B = vec3(b.x, topB, b.z);
  const at = (p: Vec3, side: number) => vec3(p.x + r.x * half * side, p.y - h, p.z + r.z * half * side);
  const inside = vec3((a.x + b.x) / 2, (topA + topB) / 2 - h / 3, (a.z + b.z) / 2);
  const cap = (p: Vec3, n: Dir) => plane3(p, vec3(p.x, p.y - 1, p.z), vec3(p.x - n.z, p.y, p.z + n.x), inside);
  return withBevels([
    plane3(A, B, at(A, -1), inside), //   левый склон
    plane3(A, B, at(A, 1), inside), //    правый склон
    plane3(at(A, -1), at(B, -1), at(A, 1), inside), // низ
    cap(A, startCap),
    cap(B, endCap),
  ], mat);
}

/**
 * Выпуклый многоугольник в вертикальной плоскости, толщиной depth в обе стороны — для фигур, которые надо развернуть.
 * Точки (u, y): u — вдоль горизонтального направления across, y — вверх, от точки origin.
 */
function prismVertical(origin: Vec3, across: Dir, points: [number, number][], depth: number, mat: string): Brush {
  const n = rightOf(across);
  const at = (u: number, y: number, w: number) => vec3(origin.x + across.x * u + n.x * w, origin.y + y, origin.z + across.z * u + n.z * w);
  const cu = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const inside = at(cu, cy, 0);
  const [p0, p1, p2] = points;
  const planes: Plane[] = [
    plane3(at(p0[0], p0[1], -depth), at(p1[0], p1[1], -depth), at(p2[0], p2[1], -depth), inside),
    plane3(at(p0[0], p0[1], depth), at(p1[0], p1[1], depth), at(p2[0], p2[1], depth), inside),
  ];
  points.forEach(([u, y], i) => {
    const [nu, ny] = points[(i + 1) % points.length];
    planes.push(plane3(at(u, y, -depth), at(nu, ny, -depth), at(u, y, depth), inside));
  });
  return withBevels(planes, mat);
}

/** Повернуть точки фигуры на угол tilt (наклон в её плоскости) и умножить на scale. */
function tilted(points: [number, number][], tilt: number, scale: number): [number, number][] {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return points.map(([u, y]) => [(u * c - y * s) * scale, (u * s + y * c) * scale]);
}

/**
 * Распятый гигант (отсылка к Евангелиону): руки раскинуты, ноги вместе, рана на груди. Свой силуэт из блоков.
 * at — середина груди, face — куда смотрит (по горизонтали), scale — размер (1 ≈ 920 ростом и 1120 в размахе рук),
 * tilt — наклон всей фигуры, радианы.
 */
function evaGiant(at: Vec3, face: Dir, scale: number, tilt: number): Brush[] {
  const across = { x: face.z, z: -face.x }; // слева направо, если смотреть фигуре в лицо
  const part = (pts: [number, number][], depth: number, mat: string) => prismVertical(at, across, tilted(pts, tilt, scale), depth * scale, mat);
  return [
    part([[-22, 150], [22, 150], [28, 230], [0, 300], [-28, 230]], 22, 'eva'), //   голова, вытянутая «клювом»
    part([[-14, 118], [14, 118], [14, 152], [-14, 152]], 16, 'eva'), //             шея
    part([[-72, 122], [72, 122], [48, -100], [-48, -100]], 34, 'eva'), //           грудь, сужается к поясу
    part([[-72, 122], [-72, 90], [-560, 200], [-560, 232]], 18, 'eva'), //          руки раскинуты чуть вверх
    part([[72, 122], [72, 90], [560, 200], [560, 232]], 18, 'eva'),
    part([[-48, -100], [48, -100], [40, -165], [-40, -165]], 28, 'eva'), //          таз
    part([[-40, -165], [40, -165], [22, -620], [-22, -620]], 24, 'eva'), //          ноги вместе, к ступням уже
    part([[-10, 40], [10, 40], [6, -60], [-6, -60]], 36, 'blood'), //               рана на груди
  ];
}

/** Огромный крест: at — перекрестье, height — высота, face — куда «смотрит», tilt — наклон. */
function bigCross(at: Vec3, face: Dir, height: number, tilt: number, mat: string): Brush[] {
  const across = { x: face.z, z: -face.x };
  const t = height * 0.045; // полутолщина бруса
  const part = (pts: [number, number][]) => prismVertical(at, across, tilted(pts, tilt, 1), t, mat);
  return [
    part([[-t, -height * 0.7], [t, -height * 0.7], [t, height * 0.3], [-t, height * 0.3]]), // столб
    part([[-height * 0.3, -t], [height * 0.3, -t], [height * 0.3, t], [-height * 0.3, t]]), // перекладина
  ];
}

function skySurf(): GameMap {
  const b: Brush[] = [];
  const t: Trigger[] = [];
  const dummies: DummySpawn[] = [];
  const HALF = 400; //      полуширина хребта
  const H = 800; //         высота сечения: склоны ~63°
  const LANE = 200; //      где едешь: на 200 от гребня по склону (на 400 ниже гребня)
  const START_TOP = 6000; // высота стартовой площадки (трасса весь круг спускается — финиш на ~5000 ниже)
  const GAP = 400; //       разрыв между хребтами…
  // …и на сколько ниже следующий: за хребет сползаешь (дуга) и над разрывом падаешь — иначе врежешься в его торец
  const GAP_DROP = 350;
  const OVERLAP = 900; //   отскок: насколько соседний хребет заходит за конец текущего…
  // …и на сколько ниже: при отскоке пролетаешь вбок и падаешь — без этого приземлялся бы у самого низа склона
  const JUMP_DROP = 350;
  const SHIFT = 900; //     …и на сколько он в стороне (основания не касаются: между склонами не было бы ложбины-ловушки)
  const RADIUS = 1500; //   радиус поворотов
  const TURN_STEPS = 6; //  из скольких хребтов поворот на 90°
  const TURN_SLOPE = 0.02; // спуск в поворотах (на единицу длины)

  // Трасса по кусочкам. ridge — хребет (длина, спуск), gap/jump — переход, turn — поворот направо на 90°
  type Piece = { ridge: number; drop: number } | 'gap' | 'jumpRight' | 'jumpLeft' | 'turn';
  const R = (ridge: number, drop: number): Piece => ({ ridge, drop });
  const pieces: Piece[] = [
    // Перед поворотом — разрыв: дуга начинается заново (иначе за длинный хребет и поворот сполз бы до низа)
    R(3500, 110), 'gap', R(3800, 110), 'gap', 'turn', //                                     запад, на север
    'gap', R(2400, 70), 'jumpRight', R(2400, 70), 'jumpLeft', R(2000, 60), 'gap', 'turn', //  север, на восток
    'gap', R(3600, 130), 'gap', R(3600, 130), 'gap', 'turn', //                              восток, на юг
    // Юг, на запад — к финишу. Длина последнего хребта подобрана так, чтобы финиш был рядом со стартом (x ≈ 1700)
    'gap', R(2400, 70), 'jumpRight', R(2400, 70), 'jumpLeft', R(2200, 70),
  ];

  type Seg = { a: Dir; b: Dir; topA: number; topB: number; dir: Dir; startCap: Dir; endCap: Dir; turn: boolean };
  const segs: Seg[] = [];
  let pos: Dir = { x: 0, z: -100 };
  let head: Dir = { x: 0, z: -1 }; // на север
  let top = START_TOP + 100; //      гребень первого хребта чуть выше площадки: под бустером склон на 300 ниже
  let joined = false; //             следующий хребет — продолжение прошлого (стык со скосом)
  let slope = 0; //                  спуск прошлого хребта на единицу длины
  const bots = ['emo_target', 'sk8_or_die', 'xX_lagger_Xx', 'myspace_angel', 'rawr_means_ily', 'pillar_kid',
    'sad_boi_2005', 'guestbook_spammer', 'flash_intro', 'webring_admin', 'hit_counter', 'under_construction',
    'blood_moon_cult', 'space_goth', 'void_staring', 'kerrang_reader', 'eyeliner_lord', 'dial_up_demon',
    'winamp_skin', 'neopets_vet', 'livejournal_ex', 'chain_wallet', 'studded_belt', 'scene_queen'];
  let botNo = 0;

  /** Коробка вокруг точки в осях трассы (along — вдоль d, lat — поперёк; повороты прямых — по осям X/Z). */
  const boxAt = (c: Dir, d: Dir, along1: number, along2: number, lat: number, y1: number, y2: number, mat: string) => {
    const r = rightOf(d);
    const xs = [c.x + d.x * along1 + r.x * lat, c.x + d.x * along2 - r.x * lat];
    const zs = [c.z + d.z * along1 + r.z * lat, c.z + d.z * along2 - r.z * lat];
    return box(Math.min(...xs), y1, Math.min(...zs), Math.max(...xs), y2, Math.max(...zs), mat);
  };
  const aabb = (c: Dir, d: Dir, along1: number, along2: number, lat: number, y1: number, y2: number) => {
    const br = boxAt(c, d, along1, along2, lat, y1, y2, 'wall');
    return [br.min, br.max] as const;
  };

  /** Мишени снаружи кольца (слева от трассы): столб с манекеном и балкон с бегающим. */
  const addTargets = (s: Seg, len: number) => {
    const out = rightOf(s.dir);
    const faceTrack = yawOf(out); // стоят слева — смотрят вправо, на трассу
    for (const [k, dist, wide] of [[0.35, 1500, false], [0.65, 1900, true]] as const) {
      const c = { x: s.a.x + s.dir.x * len * k - out.x * dist, z: s.a.z + s.dir.z * len * k - out.z * dist };
      const crest = s.topA + (s.topB - s.topA) * k;
      const pTop = crest + (wide ? -100 : 150);
      b.push(wide ? boxAt(c, s.dir, -560, 560, 160, pTop - 48, pTop, 'blood') : boxAt(c, s.dir, -72, 72, 72, pTop - 1800, pTop, 'bone'));
      dummies.push({ name: bots[botNo++ % bots.length], spawn: { feet: vec3(c.x, pTop, c.z), yaw: faceTrack }, bot: wide ? 'strafe' : 'idle' });
    }
  };

  const addSeg = (len: number, drop: number, dir: Dir, turn: boolean) => {
    const end = { x: pos.x + dir.x * len, z: pos.z + dir.z * len };
    const s: Seg = { a: pos, b: end, topA: top, topB: top - drop, dir, startCap: { x: -dir.x, z: -dir.z }, endCap: dir, turn };
    const prev = segs[segs.length - 1];
    if (joined && prev) {
      const m = { x: prev.dir.x + dir.x, z: prev.dir.z + dir.z };
      const ml = Math.hypot(m.x, m.z);
      prev.endCap = { x: m.x / ml, z: m.z / ml };
      s.startCap = { x: -m.x / ml, z: -m.z / ml };
    }
    segs.push(s);
    pos = end;
    top -= drop;
    joined = true;
    return s;
  };

  for (const p of pieces) {
    if (p === 'gap') {
      pos = { x: pos.x + head.x * GAP, z: pos.z + head.z * GAP };
      top -= GAP_DROP;
      joined = false;
    } else if (p === 'jumpRight' || p === 'jumpLeft') {
      const dir = p === 'jumpRight' ? 1 : -1;
      const r = rightOf(head);
      pos = { x: pos.x - head.x * OVERLAP + r.x * SHIFT * dir, z: pos.z - head.z * OVERLAP + r.z * SHIFT * dir };
      top += slope * OVERLAP - JUMP_DROP;
      joined = false;
    } else if (p === 'turn') {
      const step = Math.PI / 2 / TURN_STEPS;
      const chord = 2 * RADIUS * Math.sin(step / 2);
      for (let i = 0; i < TURN_STEPS; i++) {
        head = rotate(head, step / 2);
        addSeg(chord, chord * TURN_SLOPE, head, true);
        head = rotate(head, step / 2);
      }
      // Мишень в середине поворота — снаружи
      const mid = segs[segs.length - TURN_STEPS / 2];
      addTargets(mid, chord);
      dummies.pop();
      b.pop(); // от поворота оставляем только столб (балкон на дуге не помещается)
    } else {
      const s = addSeg(p.ridge, p.drop, head, false);
      slope = p.drop / p.ridge;
      addTargets(s, p.ridge);
    }
  }

  // Хребты (через один — другой цвет) и пустота под каждым: поперёк — с запасом 1500, вдоль — на разрыв
  segs.forEach((s, i) => {
    b.push(ridgeSeg(s.a, s.b, s.topA, s.topB, HALF, H, s.startCap, s.endCap, s.turn ? 'surf' : i % 2 ? 'accent' : 'surf'));
    const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
    // У первого хребта сзади не разрыв, а старт: там пролетают с катапульты — пустоту туда не тянем
    const back = i === 0 ? 0 : -GAP - 50;
    const [vmin, vmax] = aabb(s.a, s.dir, back, len + GAP + 50, HALF + 1500, -2000, Math.min(s.topA, s.topB) - H - 500);
    t.push(voidZone(vmin, vmax));
  });

  // Финиш: площадка за последним хребтом, ниже его конца (слетаешь с него на ~700 ниже гребня).
  // На площадке — «катапульта»: прыгни на ней с W на север — и снова на старте
  const fTop = top - 950;
  console.log(`  sky_surf: финиш в (${Math.round(pos.x)}, ${Math.round(pos.z)}), гребень ${Math.round(top)}, площадка ${Math.round(fTop)}`);
  b.push(boxAt(pos, head, 150, 2500, 600, fTop - 64, fTop, 'platform'));
  b.push(boxAt(pos, head, 2500, 2540, 600, fTop, fTop + 400, 'wall')); // стенка-тормоз
  const [umin, umax] = aabb(pos, head, -500, 3000, 2000, -2000, fTop - 600);
  t.push(voidZone(umin, umax));
  // Катапульта — южнее стартовой площадки (старт: x 60..1000, z 0..900), напротив проёма ворот (x 130..600).
  // Так далеко на юг, чтобы с зажатой W успеть подняться выше площадки, пока долетишь до неё (а не удариться снизу)
  b.push(box(180, fTop, 1850, 560, fTop + 2, 2250, 'pad'));
  t.push(jumpPad(vec3(180, fTop + 2, 1850), vec3(560, fTop + 32, 2250), START_TOP - fTop + 350));
  dummies.push({ name: 'finish_line_goth', spawn: { feet: vec3(-300, fTop, 1900), yaw: -Math.PI / 2 }, bot: 'bhop' });

  // Старт: площадка справа от гребня (у гребня торец хребта выше её пола), бустер на север по нашему склону
  b.push(box(60, START_TOP - 48, 0, 1000, START_TOP, 900, 'platform'));
  b.push(box(LANE - 70, START_TOP, 0, LANE + 70, START_TOP + 2, 600, 'booster'));
  t.push(booster(vec3(LANE - 70, START_TOP + 2, 0), vec3(LANE + 70, START_TOP + 40, 600), 0, -1, 900, 6000));
  t.push(voidZone(vec3(-1500, -2000, -100), vec3(2500, fTop - 600, 1100)));

  // Готические ворота на старте: колонны, стрельчатая арка, шпили-пинакли, крест на вершине
  const S = START_TOP;
  const z1 = 440;
  const z2 = 530;
  b.push(box(40, S, z1, 130, S + 560, z2, 'bone'));
  b.push(box(600, S, z1, 690, S + 560, z2, 'bone'));
  b.push(prismXY([[40, S + 560], [130, S + 560], [365, S + 840], [365, S + 940]], z1, z2, 'blood'));
  b.push(prismXY([[690, S + 560], [365, S + 940], [365, S + 840], [600, S + 560]], z1, z2, 'blood'));
  b.push(prismXY([[25, S + 560], [145, S + 560], [85, S + 800]], z1 + 10, z2 - 10, 'bone'));
  b.push(prismXY([[585, S + 560], [705, S + 560], [645, S + 800]], z1 + 10, z2 - 10, 'bone'));
  b.push(prismXY([[320, S + 920], [410, S + 920], [365, S + 1060]], z1 + 15, z2 - 15, 'bone'));
  b.push(box(355, S + 1040, z1 + 30, 375, S + 1240, z2 - 30, 'accent'));
  b.push(box(315, S + 1150, z1 + 30, 415, S + 1172, z2 - 30, 'accent'));
  // Две тонкие свечи-шпили по углам площадки сзади
  for (const x of [120, 940]) b.push(prismXY([[x - 30, S], [x + 30, S], [x, S + 700]], 840, 880, 'bone'));

  // Отсылки на Евангелион: распятые бледные гиганты (руки раскинуты, ноги вместе) стоят на красном море далеко
  // вокруг кольца, ближе к трассе и внутри — огромные кресты, все лицом к середине кольца; красный луч в небо.
  // Свои фигуры из блоков, не копия
  const ringMid = { x: 4400, z: -4000 };
  const toMid = (x: number, z: number): Dir => {
    const l = Math.hypot(ringMid.x - x, ringMid.z - z) || 1;
    return { x: (ringMid.x - x) / l, z: (ringMid.z - z) / l };
  };
  const SEA = -2400; // поверхность красного моря
  // Гиганты стоят на море (ноги — на поверхности), снаружи кольца, в 4500+ от трассы: x, z, размер (1 ≈ 920 ростом)
  const giants: [number, number, number][] = [
    [-7000, -4000, 10], //    запад
    [16000, -4000, 10.5], //  восток
    [4400, -17500, 11], //    север
    [4400, 9800, 9.5], //     юг
    [15500, -16500, 8], //    северо-восток
    [-6500, 9000, 8], //      юго-запад
    [-7000, -15500, 9], //    северо-запад
  ];
  for (const [x, z, size] of giants) b.push(...evaGiant(vec3(x, SEA + 620 * size, z), toMid(x, z), size, 0));
  // Кресты — между трассой и гигантами (и в середине кольца): x, высота перекрестья, z, высота креста, наклон, материал
  const crosses: [number, number, number, number, number, string][] = [
    [-3700, 3600, -1800, 4200, 0.1, 'blood'], //   запад
    [-3900, 4800, -6800, 4600, -0.2, 'bone'],
    [12700, 3200, -2200, 4000, -0.25, 'bone'], //  восток
    [12900, 4400, -6800, 4400, 0.15, 'blood'],
    [1800, 5200, -14200, 4600, 0.2, 'eva'], //     север
    [7200, 4600, -14200, 4000, -0.1, 'blood'],
    [2200, 2400, 6300, 3600, 0.35, 'bone'], //     юг
    [6800, 3000, 6300, 4000, -0.2, 'blood'],
    [4400, 4400, -4200, 5000, 0, 'blood'], //      середина кольца
    [2700, 2600, -1600, 2400, -0.15, 'bone'], //   внутри кольца, у южной прямой
    [6200, 4600, -7300, 2800, 0.2, 'eva'], //      внутри кольца, у северной
  ];
  for (const [x, y, z, h, tilt, mat] of crosses) {
    // Крест в середине кольца смотрит на юг (на середину не повернёшь — он в ней)
    const face = x === ringMid.x && z === -4200 ? { x: 0, z: 1 } : toMid(x, z);
    b.push(...bigCross(vec3(x, y, z), face, h, tilt, mat));
  }
  b.push(box(6800, SEA, -6200, 6860, 11000, -6140, 'beam'));
  // Море — глубоко внизу и шире дальности прорисовки во все стороны, чтобы край не был виден.
  // Оно ниже общей бездны (y −1000): долетевший туда уже погиб
  b.push(box(-30000, SEA - 64, -40000, 40000, SEA, 30000, 'lcl'));

  return {
    name: 'sky_surf',
    training: true, // в онлайне — с манекенами, в смену карт после матча не попадает
    description: 'surf ring in space under a blood moon. 37k units, gaps, ridge-hops, catapult back 2 start',
    preview: { eye: vec3(2200, 6250, 2600), yaw: 0.2, pitch: 0.12 }, // справа за стартом: луна с лицом целиком, ворота — левее
    brushes: b,
    triggers: t,
    spawns: [
      { feet: vec3(LANE, START_TOP, 800), yaw: 0 },
      { feet: vec3(LANE + 300, START_TOP, 800), yaw: 0 },
    ],
    dummies,
    skyColor: 0x07040d,
    sky: 'space',
    fogNear: 2500,
    fogFar: 12000, // кольцо большое — видно далеко (брашей ~150, слабым ПК не тяжело)
  };
}

mkdirSync('assets/maps', { recursive: true });
for (const map of [speedway(), skySurf()]) {
  const path = `assets/maps/${map.name}.map`;
  if (existsSync(path) && !force) {
    console.log(`${path} уже есть — не трогаю (перезаписать: npm run maps:generate -- --force)`);
    continue;
  }
  writeFileSync(path, writeMap(map));
  console.log(`${path}: ${map.brushes.length} брашей, ${map.spawns.length} точек появления, ${map.triggers.length} зон`);
}
