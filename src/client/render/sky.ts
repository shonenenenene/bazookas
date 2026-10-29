import { CanvasTexture, CubeTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, type Vector3 } from 'three';

/**
 * Небо «космос» (GameMap.sky = 'space'): кубическая текстура из шести картинок, нарисованных кодом —
 * звёзды, туманности и большая кровавая луна на северной грани (внутри — лицо, assets/sky/moon-face.jpg).
 * Рисуется один раз при запуске; в кадре это +1 draw call (фон сцены).
 * Малая «ангельская» луна в зените (внутри — кадр, assets/sky/moon-tv.jpg) — отдельный квадрат (ZenithMoon, ещё +1 draw call):
 * он поворачивается вслед за взглядом, чтобы надпись всегда читалась. Картинки — по желанию: их нет — луны обычные.
 * Цвет фона = цвет тумана карты, чтобы далёкие блоки растворялись в нём без шва.
 */

const SIZE = 512; // сторона одной грани, пикселей (рендер всё равно в низком разрешении)

// Картинки для лун: Vite находит их в assets/sky (папки может не быть — тогда список пустой)
const PICTURES = import.meta.glob('../../../assets/sky/*.{jpg,jpeg,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const picture = (name: string) => Object.entries(PICTURES).find(([path]) => path.includes(name))?.[1];

/** Большая луна: где на северной грани (доли стороны) и радиус, пикселей */
const BIG = { x: 0.4, y: 0.38, r: 54 };
/** Малая луна — на своей картинке 512×512 (вокруг — место под сияние и лучи) */
const SMALL = { x: 256, y: 256, r: 80 };
/** Малая луна в небе: на сколько над камерой и какой угловой радиус (градусы) */
const ZENITH = { height: 5000, radiusDeg: 6.5 };

/**
 * Кадр для малой луны (moon-tv.jpg, 704×528): какой круг из него показать — центр и радиус в пикселях кадра
 * (по центру — надпись), и где на кадре логотип канала — он за краем круга, поэтому его копию рисуем ближе к центру.
 * Другая картинка — поправь цифры (если кадр другого размера, всё масштабируется по ширине).
 */
const TV = { cx: 350, cy: 255, r: 255, logo: { x: 532, y: 40, w: 115, h: 36 }, logoShift: { x: -110, y: 55 } };

/** Генератор случайных чисел с зерном — небо каждый раз одинаковое. */
function seeded(seed: number): () => number {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function css(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
}

/** Фон грани: цвет, туманности (только в середине — иначе на стыках граней куба шов) и звёзды. */
function drawSpace(ctx: CanvasRenderingContext2D, base: number, rand: () => number, stars: number): void {
  ctx.fillStyle = css(base, 1);
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let i = 0; i < 3; i++) {
    const x = SIZE * (0.3 + rand() * 0.4);
    const y = SIZE * (0.3 + rand() * 0.4);
    const r = SIZE * (0.12 + rand() * 0.14);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const color = [0x5a1a8a, 0x9a1060, 0x2a2a8a][i % 3];
    g.addColorStop(0, css(color, 0.22 + rand() * 0.12));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  // Звёзды: в основном тусклые точки, изредка яркие с крестиком-бликом
  for (let i = 0; i < stars; i++) {
    const x = Math.floor(rand() * SIZE);
    const y = Math.floor(rand() * SIZE);
    const b = rand();
    const tint = [0xffffff, 0xffd6f0, 0xc8d8ff, 0xfff2c0][Math.floor(rand() * 4)];
    ctx.fillStyle = css(tint, 0.25 + b * 0.75);
    const s = b > 0.97 ? 2 : 1;
    ctx.fillRect(x, y, s, s);
    if (b > 0.985) {
      ctx.fillStyle = css(tint, 0.35);
      ctx.fillRect(x - 3, y, 7 + s - 1, 1);
      ctx.fillRect(x, y - 3, 1, 7 + s - 1);
    }
  }
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, color: number, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  g.addColorStop(0, css(color, alpha));
  g.addColorStop(0.45, css(color, alpha * 0.3));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r1, y - r1, r1 * 2, r1 * 2);
}

/** Объём шара: светлее слева сверху, темнее к краю. */
function sphereShade(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, light: number, dark: number): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, css(light, 0.25));
  g.addColorStop(0.7, css(dark, 0.2));
  g.addColorStop(1, css(dark, 0.75));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * Кровавая луна: багровое свечение, внутри — лицо (картинка, если есть) в красном свете, иначе диск с «морями».
 * Картинка обрезается кругом по центру — лицо с причёской на фото примерно посередине.
 */
function drawBloodMoon(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, rand: () => number): void {
  const x = BIG.x * SIZE;
  const y = BIG.y * SIZE;
  const r = BIG.r;
  glow(ctx, x, y, r * 0.8, r * 3.2, 0xff1a2a, 0.55);

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    // Квадрат по меньшей стороне — по центру, чуть выше середины (там глаза)
    const side = Math.min(img.width, img.height) * 0.92;
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) * 0.35;
    ctx.drawImage(img, sx, sy, side, side, x - r, y - r, r * 2, r * 2);
    // Красный свет: умножаем на багровый (белое станет красным, тёмное останется тёмным)…
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#ff3a2c';
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // …и чуть подсвечиваем красным поверх — «освещение»
    ctx.globalCompositeOperation = 'screen';
    glow(ctx, x - r * 0.3, y - r * 0.4, 0, r * 1.2, 0x8a0010, 0.6);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.fillStyle = '#c8141e';
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = css(0x5a0410, 0.35 + rand() * 0.25);
      ctx.beginPath();
      ctx.arc(x + (rand() - 0.5) * r * 1.5, y + (rand() - 0.5) * r * 1.5, r * (0.08 + rand() * (i < 3 ? 0.35 : 0.12)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  sphereShade(ctx, x, y, r, 0xffb090, 0x300008);
  ctx.restore();
}

/** Малая луна «ангельская»: белое сияние и лучи, внутри — кадр на весь круг (картинка, если есть). */
function drawAngelMoon(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null): void {
  const { x, y, r } = SMALL;

  // Лучи «от небес»: тонкие белые клинья во все стороны
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const len = r * (1.9 + (i % 3) * 0.35);
    ctx.fillStyle = css(0xfff8e8, i % 2 ? 0.05 : 0.09);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a - 0.06) * len, y + Math.sin(a - 0.06) * len);
    ctx.lineTo(x + Math.cos(a + 0.06) * len, y + Math.sin(a + 0.06) * len);
    ctx.fill();
  }
  ctx.restore();
  glow(ctx, x, y, r * 0.9, r * 2.3, 0xffffff, 0.6);

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const k = img.width / 704; // цифры TV — для кадра шириной 704
    const tr = TV.r * k;
    ctx.drawImage(img, (TV.cx - TV.r) * k, (TV.cy - TV.r) * k, tr * 2, tr * 2, x - r, y - r, r * 2, r * 2);
    // Логотип — копией внутрь круга (на своём месте он за краем)
    const s = r / tr; // пикселей луны на пиксель кадра
    const L = TV.logo;
    const lx = x + (L.x + TV.logoShift.x - TV.cx) * k * s;
    const ly = y + (L.y + TV.logoShift.y - TV.cy) * k * s;
    ctx.drawImage(img, L.x * k, L.y * k, L.w * k, L.h * k, lx, ly, L.w * k * s, L.h * k * s);
  } else {
    ctx.fillStyle = '#e8eef8';
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Край светлый, а не тёмный: «ангельская» луна светится сама (и логотип у края не тонет в тени)
  sphereShade(ctx, x, y, r, 0xffffff, 0xf4f6ff);
  ctx.restore();

  // Нимб: тонкое светлое кольцо по краю
  ctx.strokeStyle = css(0xffffff, 0.7);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.stroke();
}

function loadImage(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Космос для scene.background. base — цвет тумана карты (GameMap.skyColor). Картинки лун догружаются сами. */
export function createSpaceSky(base: number): CubeTexture {
  const rand = seeded(2005);
  // Порядок граней куба в Three.js: +X, −X, +Y (верх — малая луна), −Y (низ), +Z (юг), −Z (север — большая луна)
  const stars = [700, 700, 1000, 500, 700, 700];
  const faces = stars.map(() => {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    return c;
  });
  faces.forEach((c, i) => drawSpace(c.getContext('2d')!, base, rand, stars[i]));

  // Северная грань: фон запоминаем, чтобы перерисовать луну, когда загрузится картинка
  const north = faces[5].getContext('2d')!;
  const northBack = north.getImageData(0, 0, SIZE, SIZE);
  const drawMoon = (face: HTMLImageElement | null) => {
    north.putImageData(northBack, 0, 0);
    drawBloodMoon(north, face, seeded(7));
  };
  drawMoon(null);

  const tex = new CubeTexture(faces);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  void loadImage(picture('moon-face')).then((face) => {
    if (!face) return;
    drawMoon(face);
    tex.needsUpdate = true;
  });
  return tex;
}

/**
 * Малая луна в зените: квадрат с картинкой высоко над камерой, лицом вниз. Каждый кадр едет вместе с камерой
 * (как небо — не приблизишься) и поворачивается по взгляду: верх картинки — в сторону спины игрока. Так она
 * на экране всегда стоит ровно, когда смотришь вверх (у камеры, поднятой вверх, «верх экрана» смотрит назад).
 */
export class ZenithMoon {
  readonly mesh: Mesh;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    drawAngelMoon(ctx, null);
    const tex = new CanvasTexture(canvas);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    void loadImage(picture('moon-tv')).then((img) => {
      if (!img) return;
      ctx.clearRect(0, 0, 512, 512);
      drawAngelMoon(ctx, img);
      tex.needsUpdate = true;
    });
    // Размер квадрата: луна (радиус SMALL.r из 256) видна под углом radiusDeg
    const size = 2 * ZENITH.height * Math.tan((ZENITH.radiusDeg * Math.PI) / 180) * (256 / SMALL.r);
    const material = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    this.mesh = new Mesh(new PlaneGeometry(size, size), material);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.renderOrder = -1; // раньше остального прозрачного (частиц): это часть неба
  }

  /** Раз в кадр, после камеры: встать над ней и повернуться по взгляду (yaw). */
  update(cameraPos: Vector3, yaw: number): void {
    this.mesh.position.set(cameraPos.x, cameraPos.y + ZENITH.height, cameraPos.z);
    // Лицом вниз (поворот на 90° вокруг X), верх картинки — на юг; затем вокруг вертикали на yaw — верх назад, за спину
    this.mesh.rotation.set(Math.PI / 2, yaw, 0);
    this.mesh.updateMatrixWorld();
  }
}
