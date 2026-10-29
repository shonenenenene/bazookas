// ─────────────────────────────────────────────────────────────
// Арсенал. Каждая базука — просто набор чисел.
// Хочешь новую — скопируй запись и поменяй цифры. Порядок в списке = клавиши 1, 2, 3, 4…
// Модель базуки в руках — в client/render/viewmodel.ts (по тому же порядку).
// ─────────────────────────────────────────────────────────────

export interface WeaponDef {
  name: string;
  /** Подпись-мем в меню */
  motto: string;
  /** Строка в ленте убийств: {a} — кто убил, {t} — кого */
  killMsg: string;
  /** Скорость вылета ракеты, u/s (для сравнения: бег 320) */
  speed: number;
  /** Доля гравитации: 0 — летит по прямой, 1 — падает как камень (800 u/s²) */
  gravity: number;
  /** Секунд между выстрелами */
  reload: number;
  /** Урон при прямом попадании (в тело) */
  directDamage: number;
  /** Урон прямым попаданием в голову. Не задан — directDamage × COMBAT.headshotScale */
  headDamage?: number;
  /** Урон взрывом в эпицентре (к краю радиуса падает до 0) */
  splashDamage: number;
  splashRadius: number;
  /** Множитель отбрасывания — от него же зависит сила рокет-джампа */
  knockback: number;
  /** Ракет за выстрел */
  rockets: number;
  /** Угол между ракетами веером, градусы (если ракет больше одной) */
  spread: number;
  /** Через сколько секунд полёта ракета взрывается сама */
  lifetime: number;
  /** Цвет ракеты, следа и взрыва */
  color: number;
  /** Сколько раз снаряд отскакивает от стен, прежде чем взорваться (0 или не задано — взрыв сразу) */
  bounces?: number;
  /** Какая доля скорости остаётся после отскока */
  bounceDamp?: number;
  /**
   * Разброс при частой стрельбе (как в CS): первый выстрел — точно в прицел, каждый следующий добавляет
   * bloomPerShot градусов разброса (не больше bloomMax). Перестал стрелять — уходит со скоростью bloomRecovery °/с.
   * Не задано — базука всегда стреляет точно
   */
  bloomPerShot?: number;
  bloomMax?: number;
  bloomRecovery?: number;
  /**
   * Звук выстрела (client/audio/sound.ts): rocket — по умолчанию, pistol — хлёсткий выстрел, thump — «бульк» гранатомёта,
   * blade — металлический «вжик» выкидного ножа
   */
  fireSound?: 'rocket' | 'pistol' | 'thump' | 'blade';
  /** Звук взрыва: не задано — обычный, blades — взрыв + звон разлетающихся ножей */
  explodeSound?: 'blades';
  /** Как рисовать: не задано — светящийся шарик, knife — лезвие по направлению полёта; попав в стену, нож торчит из неё */
  look?: 'knife';
  /** Размер ракеты на экране (×). Не задано — 1 */
  size?: number;
  /**
   * Насколько урон взрыва слабеет к краю радиуса: 1 — до нуля (по умолчанию), 0 — не слабеет вовсе
   * (во всём радиусе полный урон — и толчок тоже)
   */
  splashFalloff?: number;
  /** Подрыв по кнопке: снаряд летит, пока не нажмёшь «огонь» ещё раз (или не врежется, или не кончится lifetime) */
  remote?: boolean;
  /**
   * Осколки после взрыва: count снарядов базуки name (скрытой — см. hidden).
   * pattern ring (по умолчанию) — кольцом во все стороны со скоростью speed; rise — скорость вверх (минус — вниз),
   * по очереди для каждого осколка: [140, −70] — через один чуть вверх и чуть вниз.
   * pattern rain — дождь: осколки равномерно заполняют круг (горизонтальная скорость от 0 до speed), а скорость вверх —
   * вразнобой от rise[0] до rise[1]: одни сперва подлетают, другие сразу летят вниз — падают не разом, а дождём
   */
  children?: { name: string; count: number; speed: number; rise: number[]; pattern?: 'ring' | 'rain' };
  /** Не базука, а осколок другой базуки: клавишей не выбрать, в меню нет. Скрытые — в конце списка */
  hidden?: boolean;
  /** Попадание без звука взрыва (мелкие осколки: десяток разом — каша) */
  silent?: boolean;
}

export const WEAPONS: WeaponDef[] = [
  {
    name: "Ol'",
    motto: 'the classic. point. click. boom.',
    killMsg: '{a} rocketed {t}',
    speed: 1600,
    gravity: 0.2, //    лёгкое падение: на дальней дистанции целься чуть выше
    reload: 0.8,
    directDamage: 100,
    splashDamage: 90,
    splashRadius: 130,
    knockback: 1,
    rockets: 1,
    spread: 0,
    lifetime: 6,
    color: 0xff7a1a,
  },
  {
    name: 'Desert Bazooagle',
    motto: 'one tap. ur helmet is a suggestion',
    killMsg: '{a} deagled {t}',
    speed: 4000, //     почти мгновенно — как пуля
    gravity: 0.02,
    reload: 0.45,
    directDamage: 30, // в тело — немного…
    headDamage: 100, // …а в голову — наповал
    splashDamage: 0, //  взрыва нет: только прямое попадание (и рокет-джампа с неё тоже нет)
    splashRadius: 30, // радиус только для картинки вспышки
    knockback: 0.5,
    rockets: 1,
    spread: 0,
    lifetime: 1.5,
    color: 0xffd23f,
    bloomPerShot: 3, // стреляешь без пауз — каждая пуля всё дальше от прицела (до 6°)…
    bloomMax: 6,
    bloomRecovery: 10, // …перестал — за ~0.3 с на каждую выпущенную пулю снова точно (после очереди — до 0.6 с)
    fireSound: 'pistol',
  },
  {
    name: 'Switchblade Serenade',
    motto: 'click to throw. click again. it rains knives',
    killMsg: '{a} serenaded {t} with switchblades',
    speed: 900,
    gravity: 0.3,
    reload: 1.0,
    directDamage: 35, // прямое попадание: 35 тому, в кого попал (плюс ножи)
    splashDamage: 0, //  взрыв сам не ранит и не толкает — урон только от ножей
    splashRadius: 150, // радиус только для картинки вспышки
    knockback: 0.8,
    rockets: 1,
    spread: 0,
    lifetime: 4, //      не подорвал сам — взорвётся через 4 с
    color: 0xc0c8e0,
    remote: true, //     второй клик — взрыв…
    // …и дождь из 27 ножей: подорвал в воздухе — сыплются вниз кругом (чем выше подрыв, тем шире круг)
    children: { name: 'switchblade', count: 27, speed: 260, rise: [320, -220], pattern: 'rain' },
    fireSound: 'blade',
    explodeSound: 'blades',
  },
  {
    name: 'Bouncy Castle',
    motto: 'it bounces. like ur ex. then it has kids',
    killMsg: '{a} bank-shotted {t}',
    speed: 800,
    gravity: 0.7, //    летит как граната — по дуге
    reload: 0.9,
    directDamage: 70,
    splashDamage: 80,
    splashRadius: 140,
    knockback: 1,
    rockets: 1,
    spread: 0,
    lifetime: 2.5, //   взрывается сама, даже если ещё прыгает
    color: 0x00e5ff,
    bounces: 2, //      отскакивает от стен и пола, третье касание — бум…
    bounceDamp: 0.65,
    children: { name: 'bouncelet', count: 5, speed: 210, rise: [190] }, // …и разлетается на 5 гранаток (недалеко)
    fireSound: 'thump',
  },
  {
    name: 'Breakdown Mortar',
    motto: 'the drop hits harder than ur dad. slow tho',
    killMsg: '{a} dropped the breakdown on {t}',
    speed: 600, //      медленная — увернуться можно, если видишь
    gravity: 0.15,
    reload: 1.8,
    directDamage: 150,
    splashDamage: 100, // взрыв убивает с полных 100 HP…
    splashRadius: 380, // …во всём огромном радиусе (урон к краю не слабеет)
    splashFalloff: 0,
    knockback: 1.3, //  рокет-джамп: толчок 650 где угодно в радиусе
    rockets: 1,
    spread: 0,
    lifetime: 6,
    color: 0xb3001b,
    size: 2, //         снаряд вдвое больше
  },

  // ─── Осколки (скрытые: клавишей не выбрать) ───
  {
    name: 'switchblade',
    motto: '',
    killMsg: '{a} shanked {t}',
    speed: 260, //      (скорость задаёт children у Switchblade Serenade)
    gravity: 1.6, //    падают вниз остриём — и втыкаются в пол
    reload: 0,
    directDamage: 10,
    headDamage: 25, //   в голову — 25 (дождь сверху часто попадает в голову)
    splashDamage: 0,
    splashRadius: 16,
    knockback: 0.3,
    rockets: 1,
    spread: 0,
    lifetime: 3, //     не воткнулся никуда (над пропастью) — через 3 с пропадает
    color: 0xe8ecff,
    look: 'knife', //   лезвие; воткнулся — торчит и гаснет
    hidden: true,
    silent: true,
  },
  {
    name: 'bouncelet',
    motto: '',
    killMsg: '{a} kid-castled {t}',
    speed: 420,
    gravity: 1,
    reload: 0,
    directDamage: 20,
    splashDamage: 20,
    splashRadius: 93, // на треть меньше, чем у самого замка (140)
    knockback: 0.6,
    rockets: 1,
    spread: 0,
    lifetime: 1.6,
    color: 0x7ff6ff,
    bounces: 1, //      один отскок — и бум
    bounceDamp: 0.6,
    size: 0.6,
    hidden: true,
  },
];

/** Сколько настоящих базук (клавиши 1…N). Скрытые осколки — после них */
export const WEAPON_COUNT = WEAPONS.filter((w) => !w.hidden).length;

/** Номер базуки по имени (для children). Нет такой — ошибка сразу при запуске, а не тихий баг */
export function weaponIndex(name: string): number {
  const i = WEAPONS.findIndex((w) => w.name === name);
  if (i < 0) throw new Error(`Нет базуки «${name}» (weapons.ts)`);
  return i;
}
