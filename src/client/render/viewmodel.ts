import { Group, Mesh, MeshBasicMaterial, Scene } from 'three';
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
  // 1. Ol' Reliable — армейская труба
  [
    [-3.5, -3.5, -52, 3.5, 3.5, -4, 0x5d6b3a], //  труба
    [-4.5, -4.5, -58, 4.5, 4.5, -52, 0x2a2a2e], // раструб
    [-4.5, -4.5, -6, 4.5, 4.5, 2, 0x2a2a2e], //    казённик
    [-1.5, -11, -30, 1.5, -3.5, -25, 0x4a3020], // рукоятка
    [-1, 3.5, -36, 1, 6.5, -31, 0x111111], //      прицел
  ],
  // 2. Granny's Mortar — пухлая розовая труба с кислотной полосой
  [
    [-4.5, -4.5, -40, 4.5, 4.5, -2, 0xd98bb5],
    [-5, -5, -30, 5, 5, -26, 0x39ff14],
    [-5.5, -5.5, -46, 5.5, 5.5, -40, 0x3a2a40],
    [-1.5, -12, -24, 1.5, -4.5, -19, 0x4a3020],
  ],
  // 3. Railzooka 9000 — длинная хромированная с рельсами цвета маджента
  [
    [-2.5, -2.5, -78, 2.5, 2.5, -2, 0xcfd3e0],
    [-4, -1, -70, -2.5, 1, -8, 0xff1aa8],
    [2.5, -1, -70, 4, 1, -8, 0xff1aa8],
    [-1.5, -10, -28, 1.5, -2.5, -23, 0x222228],
    [-1.5, 2.5, -40, 1.5, 5.5, -30, 0x111111],
  ],
  // 4. Spam Can — три трубки в связке
  [
    [-6, -2, -46, -2, 2, -4, 0xb59a2a],
    [-2, -2, -50, 2, 2, -4, 0xb59a2a],
    [2, -2, -46, 6, 2, -4, 0xb59a2a],
    [-6.5, -2.5, -24, 6.5, 2.5, -18, 0x8a1c2b],
    [-1.5, -11, -28, 1.5, -2.5, -23, 0x4a3020],
  ],
];

/** Где базука относительно глаз: правее и ниже, задний конец уходит за край экрана */
const REST = { x: 15, y: -12, z: -4 };

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

    this.holder.position.set(
      REST.x + bobX,
      REST.y + bobY - this.recoil * 1.5 - this.switching * 14,
      REST.z + this.recoil * 8, // отдача назад
    );
    this.holder.rotation.x = this.recoil * 0.25; // и задираем ствол
  }
}
