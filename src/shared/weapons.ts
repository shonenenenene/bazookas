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
  /** Урон при прямом попадании */
  directDamage: number;
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
}

export const WEAPONS: WeaponDef[] = [
  {
    name: "Ol' Reliable",
    motto: 'the classic. point. click. boom.',
    killMsg: '{a} rocketed {t}',
    speed: 1000,
    gravity: 0.25, //   лёгкое падение: на дальней дистанции целься чуть выше
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
    name: "Granny's Mortar",
    motto: 'lobs love over walls. aim UP',
    killMsg: "{a} delivered granny's cookies to {t}",
    speed: 850,
    gravity: 0.9, //    крутая дуга, достаёт из-за укрытий
    reload: 1.3,
    directDamage: 120,
    splashDamage: 110,
    splashRadius: 200,
    knockback: 1.3, //  самый мощный рокет-джамп
    rockets: 1,
    spread: 0,
    lifetime: 8,
    color: 0x39ff14,
  },
  {
    name: 'Railzooka 9000',
    motto: 'faster than ur ping',
    killMsg: "{a} railzooka'd {t} into next week",
    speed: 2500,
    gravity: 0.04, //   почти прямая: для дальних целей
    reload: 1.5,
    directDamage: 150,
    splashDamage: 40, //  но взрыв слабый — надо попадать точно
    splashRadius: 70,
    knockback: 0.7,
    rockets: 1,
    spread: 0,
    lifetime: 3,
    color: 0xff1aa8,
  },
  {
    name: 'Spam Can',
    motto: '3 rockets. 0 skill required',
    killMsg: '{a} turned {t} into confetti',
    speed: 900,
    gravity: 0.35,
    reload: 1.0,
    directDamage: 40,
    splashDamage: 35,
    splashRadius: 100,
    knockback: 0.7,
    rockets: 3, //      веер из трёх ракет
    spread: 6,
    lifetime: 5,
    color: 0xffe14a,
  },
];
