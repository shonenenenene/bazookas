// Список карт: встроенная тестовая арена + файлы assets/maps/*.map (их правят в TrenchBroom).
// Как достать тексты файлов, решает сторона: клиент — через Vite (client/maps.ts), сервер — с диска (server/maps.ts).

import { parseMap } from './mapFormat';
import { testMap } from './testMap';
import type { GameMap } from './types';

/** Карта, на которой начинается игра без ?map= в адресе */
export const DEFAULT_MAP = 'speedway';

/** Имя карты из адреса → безопасное: только латиница, цифры, _ и - */
export function cleanMapName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

/**
 * Найти карту по имени. files — «имя файла без .map → текст файла».
 * Нет такой — берём DEFAULT_MAP, нет и её — тестовую арену.
 * Имя карты = имя файла (а не message из worldspawn): по нему клиент и сервер понимают друг друга.
 */
export function loadMap(name: string, files: Record<string, string>): GameMap {
  if (name === testMap.name) return testMap;
  const id = name in files ? name : DEFAULT_MAP in files ? DEFAULT_MAP : null;
  if (id === null) return testMap;
  const map = parseMap(files[id], id);
  map.name = id;
  return map;
}

/** Имена всех карт — для меню. */
export function mapNames(files: Record<string, string>): string[] {
  return [...Object.keys(files).sort(), testMap.name];
}

/** Карты для меню: имя и описание. Описание — прямо из текста файла (ключ description), карту целиком не разбираем. */
export function mapList(files: Record<string, string>): { name: string; description: string }[] {
  return mapNames(files).map((name) => {
    if (name === testMap.name) return { name, description: testMap.description ?? '' };
    const m = /"description"\s+"([^"]*)"/.exec(files[name]);
    return { name, description: m ? m[1] : '' };
  });
}
