import { type Brush, type RampRise, boxBrush, rampBrush } from '../collision/brush';
import { vec3 } from '../math';
import type { GameMap } from './types';

// ─────────────────────────────────────────────────────────────
// Тестовая арена — песочница для движения: ступеньки, рампы, серф, ящики.
// Позже карты будем делать в TrenchBroom, а эта останется полигоном.
//
// Пол на y = 0, арена 2048×2048 (от −1024 до 1024 по X и Z).
// Игрок появляется на юге (z ≈ 600) и смотрит на север (−Z).
// ─────────────────────────────────────────────────────────────

/** Цвета блоков. Текстура и «запечённый» свет затемняют их, поэтому берём посветлее. */
const COLOR = {
  floor: 0x4a4058, //    пыльный фиолетовый камень
  wall: 0x3a3446, //     тёмные стены
  stairs: 0x6a6276,
  ramp: 0x5a3d7a, //     фиолетовые рампы
  platform: 0x3e3550,
  crate: 0x8a1c2b, //    кроваво-красные ящики
  accent: 0xc0207a, //   маджента
  surf: 0x1f8a6e, //     ядовитый бирюзовый серф
};

/** Блок по двум углам: (x1, y1, z1) — минимальный, (x2, y2, z2) — максимальный. */
function box(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: number): Brush {
  return boxBrush(vec3(x1, y1, z1), vec3(x2, y2, z2), color);
}

/** Рампа в коробке, поднимается в сторону `rise`. */
function ramp(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, rise: RampRise, color: number): Brush {
  return rampBrush(vec3(x1, y1, z1), vec3(x2, y2, z2), rise, color);
}

/** Лестница из `count` ступенек по 16 высотой и 32 глубиной, поднимается в сторону −X. */
function stairsTowardMinusX(xStart: number, z1: number, z2: number, count: number, color: number): Brush[] {
  const steps: Brush[] = [];
  for (let i = 0; i < count; i++) {
    const x2 = xStart - i * 32;
    steps.push(box(x2 - 32, 0, z1, x2, 16 * (i + 1), z2, color));
  }
  return steps;
}

const brushes: Brush[] = [
  // Пол и стены (стены высокие — на будущее, для рокет-джампов)
  box(-1024, -32, -1024, 1024, 0, 1024, COLOR.floor),
  box(-1056, -32, -1056, 1056, 768, -1024, COLOR.wall), // север
  box(-1056, -32, 1024, 1056, 768, 1056, COLOR.wall), //   юг
  box(-1056, -32, -1024, -1024, 768, 1024, COLOR.wall), // запад
  box(1024, -32, -1024, 1056, 768, 1024, COLOR.wall), //   восток

  // Запад: платформа высотой 128, к ней лестница и пологая рампа (30°)
  box(-1024, 0, -384, -768, 128, -128, COLOR.platform),
  ...stairsTowardMinusX(-512, -384, -256, 8, COLOR.stairs),
  ramp(-768, 0, -256, -546, 128, -128, '-x', COLOR.ramp),

  // Восток: платформа высотой 192 и крутая рампа (45°)
  box(768, 0, -384, 1024, 192, -128, COLOR.platform),
  ramp(576, 0, -384, 768, 192, -256, '+x', COLOR.ramp),

  // Серф-хребет (склоны ~56° — стоять нельзя, только скользить).
  // Заходить с восточной платформы: шагнуть с южного края на гребень и стрейфить в склон.
  ramp(608, 0, -96, 704, 144, 896, '+x', COLOR.surf),
  ramp(704, 0, -96, 800, 144, 896, '-x', COLOR.surf),

  // Центр-север: высокая плита на колонне — цель для будущих рокет-джампов
  box(-32, 0, -544, 32, 256, -480, COLOR.wall),
  box(-128, 256, -640, 128, 288, -384, COLOR.accent),

  // Ящики
  box(-300, 0, 200, -236, 64, 264, COLOR.crate),
  box(-236, 0, 200, -172, 64, 264, COLOR.crate),
  box(-268, 64, 200, -204, 128, 264, COLOR.crate),
  box(200, 0, -200, 328, 128, -72, COLOR.crate),
  box(100, 0, 300, 164, 64, 364, COLOR.crate),
];

export const testMap: GameMap = {
  name: 'test_arena',
  brushes,
  spawns: [{ feet: vec3(0, 0, 600), yaw: 0 }],
  // Манекены. yaw: 0 — смотрит на север (−Z), Math.PI — на юг
  dummies: [
    { name: 'xX_n00b_Xx', spawn: { feet: vec3(0, 0, -150), yaw: Math.PI }, bot: 'idle' }, //          прямо по курсу
    { name: 'strafe_lord', spawn: { feet: vec3(-350, 0, -20), yaw: Math.PI }, bot: 'strafe' }, //     бегает вдоль X
    { name: 'bhop_andy', spawn: { feet: vec3(-500, 0, 600), yaw: Math.PI }, bot: 'bhop' }, //         прыгает кругами
    { name: 'camper_2004', spawn: { feet: vec3(0, 288, -512), yaw: Math.PI }, bot: 'idle' }, //       на высокой плите
    { name: 'ur_mom', spawn: { feet: vec3(896, 192, -320), yaw: Math.PI / 2 }, bot: 'idle' }, //     на восточной платформе
  ],
  skyColor: 0x0d0612,
  fogNear: 300,
  fogFar: 2600,
};
