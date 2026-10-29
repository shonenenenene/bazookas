// Тексты карт assets/maps/*.map с диска. Читаем заново при создании каждой комнаты —
// поправил карту в TrenchBroom, и новая комната уже на ней (перезапускать сервер не нужно).

import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../../assets/maps/', import.meta.url);

/** «speedway» → текст файла speedway.map */
export function readMapFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = readdirSync(DIR).filter((f) => f.endsWith('.map'));
  } catch {
    return files; // папки нет — играем на тестовой арене
  }
  for (const f of names) files[f.slice(0, -'.map'.length)] = readFileSync(new URL(f, DIR), 'utf8');
  return files;
}
