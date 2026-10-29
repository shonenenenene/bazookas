// Текстуры для редактора TrenchBroom: по плитке 64×64 на каждый материал из materials.ts
// (цвет плитки = цвет блока в игре) + полосатая «trigger» для зон и значок профиля.
// Запуск: npm run textures. Пишет assets/textures/*.png и trenchbroom/Icon.png.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MATERIALS, TRIGGER_MATERIAL } from '../src/shared/maps/materials';

const SIZE = 64;

/** Плитка: цвет с тёмной рамкой и лёгкой шахматкой по 32 — чтобы в редакторе было видно сетку. */
function tile(color: number): Uint8Array {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const px = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const border = x === 0 || y === 0;
      const checker = ((x >> 5) + (y >> 5)) % 2 === 0 ? 1 : 0.9;
      const k = border ? 0.6 : checker;
      const i = (y * SIZE + x) * 3;
      px[i] = r * k;
      px[i + 1] = g * k;
      px[i + 2] = b * k;
    }
  }
  return px;
}

/** Зоны (джамп-пады, бустеры): оранжевые диагональные полосы — в игре их не видно. */
function stripes(): Uint8Array {
  const px = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const on = ((x + y) >> 3) % 2 === 0;
      const i = (y * SIZE + x) * 3;
      px[i] = on ? 255 : 60;
      px[i + 1] = on ? 140 : 30;
      px[i + 2] = on ? 0 : 0;
    }
  }
  return px;
}

/** Мини-кодировщик PNG (RGB, 8 бит): заголовок, сжатые строки пикселей, конец. */
function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // фильтр строки: «без фильтра»
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; //  бит на канал
  ihdr[9] = 2; //  RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

mkdirSync('assets/textures', { recursive: true });
for (const [name, color] of Object.entries(MATERIALS)) {
  writeFileSync(`assets/textures/${name}.png`, png(SIZE, SIZE, tile(color)));
}
writeFileSync(`assets/textures/${TRIGGER_MATERIAL}.png`, png(SIZE, SIZE, stripes()));

// Значок профиля в списке игр TrenchBroom: маджента с кислотной рамкой
const icon = new Uint8Array(32 * 32 * 3);
for (let i = 0; i < 32 * 32; i++) {
  const x = i % 32;
  const y = (i / 32) | 0;
  const edge = x < 3 || y < 3 || x > 28 || y > 28;
  icon.set(edge ? [0x39, 0xff, 0x14] : [0xff, 0x1a, 0xa8], i * 3);
}
mkdirSync('trenchbroom', { recursive: true });
writeFileSync('trenchbroom/Icon.png', png(32, 32, icon));

console.log(`textures: ${Object.keys(MATERIALS).length + 1} → assets/textures/, icon → trenchbroom/Icon.png`);
