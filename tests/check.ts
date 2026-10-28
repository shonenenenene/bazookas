// Мини-«фреймворк» для проверок: печатает PASS/FAIL, а в конце падает с ошибкой, если что-то не прошло.

let fails = 0;

export function check(name: string, ok: boolean, info: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`);
  if (!ok) fails++;
}

export function finish(): void {
  if (fails > 0) throw new Error(`${fails} проверок не прошло`);
  console.log('\nALL PASS');
}

/** Округление для красивого вывода */
export const round = (n: number) => Math.round(n * 100) / 100;
