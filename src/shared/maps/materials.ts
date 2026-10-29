// Материалы карты: имя текстуры в TrenchBroom → цвет блока в игре.
// Текстуры для редактора (assets/textures/*.png) рисуются из этой же таблицы: npm run textures.
// Новый материал — добавь строку сюда и перегенерируй текстуры.

export const MATERIALS: Record<string, number> = {
  floor: 0x4a4058, //    пыльный фиолетовый камень
  wall: 0x3a3446, //     тёмные стены
  stairs: 0x6a6276,
  ramp: 0x5a3d7a, //     фиолетовые рампы
  platform: 0x3e3550,
  crate: 0x8a1c2b, //    кроваво-красные ящики
  accent: 0xc0207a, //   маджента
  surf: 0x1f8a6e, //     ядовитый бирюзовый серф
  pad: 0x39ff14, //      джамп-пады — кислотные
  booster: 0xff1aa8, //  бустеры — маджента
  wallrun: 0x5b2a6e, //  стены для отскоков
  bone: 0xb8ad9c, //     «кость» — светлые акценты, колонны
  blood: 0x6e0f1c, //    тёмная кровь
  eva: 0xd9d0c1, //      бледные распятые гиганты (отсылка к Евангелиону)
  lcl: 0x8a0a16, //      красное море далеко внизу
  beam: 0xff1a30, //     красный луч в небо
};

/** Текстура зон (джамп-пад, бустер): в игре не рисуется, в редакторе — полупрозрачная */
export const TRIGGER_MATERIAL = 'trigger';

/** Цвет по имени текстуры. Неизвестное имя — цвет из самого имени, чтобы разные текстуры не слились. */
export function materialColor(name: string): number {
  const c = MATERIALS[name.toLowerCase()];
  if (c !== undefined) return c;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  return 0x404040 + (h & 0x7f7f7f);
}

/** Имя текстуры по цвету (для выгрузки карт из кода в .map). Нет в таблице — «wall». */
export function materialName(color: number): string {
  for (const [name, c] of Object.entries(MATERIALS)) if (c === color) return name;
  return 'wall';
}
