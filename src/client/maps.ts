// Тексты карт assets/maps/*.map — их собирает плагин в vite.config.ts и кладёт в сборку строками.
// В разработке сохранил карту в TrenchBroom — страница перезагрузится сама с новой картой.

import files from 'virtual:maps';

/** «speedway» → текст файла speedway.map */
export const MAP_FILES: Record<string, string> = files;
