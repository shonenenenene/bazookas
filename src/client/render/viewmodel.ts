import { Group, Mesh, MeshBasicMaterial, Scene, type Vector3 } from 'three';
import { boxBrush } from '../../shared/collision/brush';
import { vec3 } from '../../shared/math';
import { buildBrushGeometry } from './mapMesh';

// Базука в руках. Своя мини-сцена и своя камера (см. view.ts): рисуется поверх мира,
// поэтому не протыкает стены и не растягивается при широком FOV.
//
// Координаты моделей: x — вправо, y — вверх, −z — вперёд от глаз. Камера в (0, 0, 0).

/** Коробка: x1, y1, z1, x2, y2, z2, цвет */
type Box = [number, number, number, number, number, number, number];

/** Модели базук по порядку WEAPONS (weapons.ts). Нет своей модели — берётся первая. */
const MODELS: Box[][] = [
  // 1. Ol' — армейская труба
  [
    [-3.5, -3.5, -52, 3.5, 3.5, -4, 0x5d6b3a], //  труба
    [-4.5, -4.5, -58, 4.5, 4.5, -52, 0x2a2a2e], // раструб
    [-4.5, -4.5, -6, 4.5, 4.5, 2, 0x2a2a2e], //    казённик
    [-1.5, -11, -30, 1.5, -3.5, -25, 0x4a3020], // рукоятка
    [-1, 3.5, -36, 1, 6.5, -31, 0x111111], //      прицел
  ],
  // 2. Desert Bazooagle — хромированный «дигл», только ствол — короткая армейская труба с раструбом
  [
    [-2.2, -2, -24, 2.2, 3, -3, 0xb8bcc8], //      затвор
    [-1.8, -16, -9, 1.8, -2, -3, 0x2a2a2e], //     рукоятка
    [-0.6, -6, -15, 0.6, -2, -9, 0x2a2a2e], //     спусковая скоба
    [-2.6, -2.4, -40, 2.6, 2.8, -24, 0x5d6b3a], // ствол-базука
    [-3.4, -3.2, -45, 3.4, 3.6, -40, 0x2a2a2e], // раструб
    [-0.6, 3, -23, 0.6, 4.6, -20, 0x111111], //    мушка
  ],
  // 3. Switchblade Serenade — короткая стальная труба, вокруг дула «веер» лезвий, детонатор на рукоятке
  [
    [-3, -3, -36, 3, 3, -4, 0x8a90a8], //          труба
    [-5.5, -0.6, -40, 5.5, 0.6, -34, 0xe8ecff], // лезвия по бокам дула
    [-0.6, -5.5, -40, 0.6, 5.5, -34, 0xe8ecff], // лезвия сверху и снизу
    [-3.6, -3.6, -42, 3.6, 3.6, -36, 0x2a2a2e], // дуло
    [-1.5, -12, -14, 1.5, -3, -9, 0x2a2a2e], //    рукоятка
    [-1, -6, -18, 1, -3, -15, 0xb3001b], //        красная кнопка подрыва
  ],
  // 4. Bouncy Castle — короткий гранатомёт с барабаном цвета «надувного замка»
  [
    [-3.5, -3.5, -38, 3.5, 3.5, -4, 0x00a8bd], //  труба
    [-4.5, -4.5, -22, 4.5, 4.5, -14, 0xff1aa8], // барабан
    [-4.5, -4.5, -42, 4.5, 4.5, -38, 0xffe14a], // жёлтое дуло
    [-1.5, -12, -10, 1.5, -3.5, -5, 0x4a3020], //  рукоятка
  ],
  // 5. Breakdown Mortar — огромная чёрная труба с кровавыми полосами
  [
    [-6, -6, -56, 6, 6, -2, 0x18141c], //          труба
    [-6.5, -6.5, -46, 6.5, 6.5, -43, 0xb3001b], // полосы
    [-6.5, -6.5, -24, 6.5, 6.5, -21, 0xb3001b],
    [-7.5, -7.5, -62, 7.5, 7.5, -56, 0x2a2a2e], // раструб
    [-1.5, -14, -30, 1.5, -6, -25, 0x4a3020], //   рукоятка
  ],
];

/** Конец ствола каждой модели (x, y, z) — оттуда на экране вылетает ракета */
const MUZZLES: [number, number, number][] = [
  [0, 0, -58],
  [0, 0.2, -45],
  [0, 0, -42],
  [0, 0, -42],
  [0, 0, -62],
];

/** Где базука относительно глаз: правее и ниже, задний конец уходит за край экрана */
const REST = { x: 15, y: -12, z: -4 };

/** Сдвиг от REST для отдельных моделей (x, y, z): короткую держим дальше от лица, чтобы её было видно целиком */
const OFFSETS: [number, number, number][] = [
  [0, 0, 0],
  [-2, 4, -16], // Desert Bazooagle: пистолет — вперёд и выше, видна рукоятка
  [0, 0, -6],
  [0, 0, -6],
  [0, 0, -4],
];

export class Viewmodel {
  readonly scene = new Scene();
  private holder = new Group();
  private models: Mesh[] = [];
  private shown = -1;
  private recoil = 0; //  1 сразу после выстрела → 0
  private switching = 0; // 1 сразу после смены базуки → 0 (базука «поднимается»)
  private bobPhase = 0;

  constructor() {
    const material = new MeshBasicMaterial({ vertexColors: true });
    for (const boxes of MODELS) {
      const brushes = boxes.map(([x1, y1, z1, x2, y2, z2, color]) => boxBrush(vec3(x1, y1, z1), vec3(x2, y2, z2), color));
      const mesh = new Mesh(buildBrushGeometry(brushes), material);
      mesh.visible = false;
      this.models.push(mesh);
      this.holder.add(mesh);
    }
    this.holder.rotation.y = 0.05; // чуть довёрнута к прицелу
    this.scene.add(this.holder);
  }

  /** Отдача при выстреле. */
  kick(): void {
    this.recoil = 1;
  }

  /** Конец ствола в координатах камеры базуки (с учётом покачивания и отдачи). */
  muzzle(out: Vector3): Vector3 {
    const [x, y, z] = MUZZLES[Math.max(this.shown, 0)] ?? MUZZLES[0];
    return this.holder.localToWorld(out.set(x, y, z));
  }

  update(dt: number, weapon: number, speed: number, onGround: boolean, dead: boolean): void {
    const index = weapon < this.models.length ? weapon : 0;
    if (index !== this.shown) {
      if (this.shown >= 0) this.models[this.shown].visible = false;
      this.models[index].visible = true;
      if (this.shown >= 0) this.switching = 1;
      this.shown = index;
    }
    this.holder.visible = !dead;

    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.switching = Math.max(0, this.switching - dt * 5);

    // Покачивание при беге
    const bob = onGround ? Math.min(speed / 320, 1) : 0;
    this.bobPhase += dt * speed * 0.035;
    const bobX = Math.sin(this.bobPhase) * 0.9 * bob;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.9 * bob;

    const [ox, oy, oz] = OFFSETS[this.shown] ?? OFFSETS[0];
    this.holder.position.set(
      REST.x + ox + bobX,
      REST.y + oy + bobY - this.recoil * 1.5 - this.switching * 14,
      REST.z + oz + this.recoil * 8, // отдача назад
    );
    this.holder.rotation.x = this.recoil * 0.25; // и задираем ствол
    this.holder.updateMatrixWorld(); // для muzzle() — до отрисовки
  }
}
