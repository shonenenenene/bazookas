import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import { MOVE } from '../../shared/config';
import type { Vec3 } from '../../shared/math';

// Все светящиеся эффекты — ракеты, их следы, взрывы, ошмётки — это частицы в ОДНОМ объекте:
// один draw call на всё. Данные лежат в типизированных массивах, новых объектов не создаём.
// Смешивание «сложением» (additive): частицы светятся и гаснут, затухая в чёрный.

/** Сколько частиц живёт одновременно. Новые затирают самые старые. */
const MAX = 4096;
/** Плюс место под «головы» ракет, которые добавляются каждый кадр */
const MAX_DRAW = MAX + 512;

const vertexShader = /* glsl */ `
  attribute vec3 pcolor;
  attribute float psize;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = psize * uScale / -mv.z; // размер в мировых юнитах → в пиксели
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;      // 0 в центре, 1 на краю
    if (d > 1.0) discard;           // круглая частица
    gl_FragColor = vec4(vColor * (1.0 - d), 1.0); // мягко гаснет к краю
  }
`;

export class Particles {
  readonly object: Points;
  private material: ShaderMaterial;
  private geometry: BufferGeometry;

  // Состояние частиц (структура массивов — быстро и без мусора)
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX); //   сколько осталось жить, сек (≤ 0 — мёртвая)
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private gravity = new Float32Array(MAX); // доля обычной гравитации
  private next = 0;

  // Что уходит в видеокарту
  private gpuPos = new Float32Array(MAX_DRAW * 3);
  private gpuCol = new Float32Array(MAX_DRAW * 3);
  private gpuSize = new Float32Array(MAX_DRAW);
  private count = 0;

  constructor() {
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.gpuPos, 3));
    this.geometry.setAttribute('pcolor', new BufferAttribute(this.gpuCol, 3));
    this.geometry.setAttribute('psize', new BufferAttribute(this.gpuSize, 1));
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexShader,
      fragmentShader,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.object = new Points(this.geometry, this.material);
    this.object.frustumCulled = false; // частицы по всей карте — проверять видимость объекта целиком бессмысленно
  }

  /** Выпустить частицу. color — 0xRRGGBB, brightness — множитель яркости. */
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number, color: number, brightness = 1, gravity = 0,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i3] = (((color >> 16) & 255) / 255) * brightness;
    this.col[i3 + 1] = (((color >> 8) & 255) / 255) * brightness;
    this.col[i3 + 2] = ((color & 255) / 255) * brightness;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.gravity[i] = gravity;
  }

  /** Сдвинуть все частицы на dt и собрать живые в буфер видеокарты. Вызывать раз в кадр. */
  update(dt: number): void {
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;

      const i3 = i * 3;
      this.vel[i3 + 1] -= MOVE.gravity * this.gravity[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const fade = this.life[i] / this.maxLife[i]; // тускнеет к концу жизни
      const n3 = n * 3;
      this.gpuPos[n3] = this.pos[i3];
      this.gpuPos[n3 + 1] = this.pos[i3 + 1];
      this.gpuPos[n3 + 2] = this.pos[i3 + 2];
      this.gpuCol[n3] = this.col[i3] * fade;
      this.gpuCol[n3 + 1] = this.col[i3 + 1] * fade;
      this.gpuCol[n3 + 2] = this.col[i3 + 2] * fade;
      this.gpuSize[n] = this.size[i];
      n++;
    }
    this.count = n;
  }

  /** Добавить точку только на этот кадр (головы ракет). Вызывать после update(). */
  addPoint(p: Vec3, size: number, color: number, brightness = 1): void {
    if (this.count >= MAX_DRAW) return;
    const n3 = this.count * 3;
    this.gpuPos[n3] = p.x;
    this.gpuPos[n3 + 1] = p.y;
    this.gpuPos[n3 + 2] = p.z;
    this.gpuCol[n3] = (((color >> 16) & 255) / 255) * brightness;
    this.gpuCol[n3 + 1] = (((color >> 8) & 255) / 255) * brightness;
    this.gpuCol[n3 + 2] = ((color & 255) / 255) * brightness;
    this.gpuSize[this.count] = size;
    this.count++;
  }

  /** Отправить кадр в видеокарту (только занятую часть буферов). */
  commit(pointScale: number): void {
    this.material.uniforms.uScale.value = pointScale;
    this.geometry.setDrawRange(0, this.count);
    for (const name of ATTRS) {
      const attr = this.geometry.getAttribute(name) as BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}

const ATTRS = ['position', 'pcolor', 'psize'] as const;
