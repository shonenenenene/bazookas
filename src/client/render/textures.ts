import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three';

/**
 * Процедурная текстура «каменной плитки» 64×64: серый шум и тёмные швы.
 * Рисуется кодом при запуске, файлы грузить не надо. Цвет берётся из вершин,
 * текстура только добавляет фактуру (поэтому она серая).
 */
export function createTileTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  // Простой генератор случайных чисел с зерном — текстура каждый раз одинаковая
  let seed = 1337;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 215 + (rand() - 0.5) * 36; // «зерно» камня
      if (x === 0 || y === 0) v = 110; //   шов
      else if (x === 1 || y === 1) v = 240; // светлая кромка под швом — объём
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter; // мягкая фильтрация, как на PS2
  tex.minFilter = LinearMipmapLinearFilter; // мипмапы: вдали текстура не рябит
  return tex;
}
