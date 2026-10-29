// Тип для виртуального модуля с картами (его создаёт плагин в vite.config.ts).
declare module 'virtual:maps' {
  /** «speedway» → текст файла speedway.map */
  const files: Record<string, string>;
  export default files;
}
