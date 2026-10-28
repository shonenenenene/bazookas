import { TICK_DT } from '../shared/config';

/**
 * Игровой цикл с фиксированным шагом.
 *
 * Физика (tick) считается строго TICK_RATE раз в секунду — одинаково на любом ПК,
 * поэтому прыжки и скорость не зависят от FPS. Отрисовка (render) идёт так часто,
 * как может монитор; `alpha` (0..1) говорит, насколько мы между прошлым и текущим тиком —
 * по нему картинка плавно интерполируется.
 */
export function startLoop(tick: () => void, render: (alpha: number, frameDt: number) => void): void {
  let last = performance.now();
  let accumulator = 0;

  function frame(now: number) {
    requestAnimationFrame(frame);
    // После сворачивания вкладки не «догоняем» сотни тиков разом
    const frameDt = Math.min((now - last) / 1000, 0.25);
    last = now;

    accumulator += frameDt;
    while (accumulator >= TICK_DT) {
      tick();
      accumulator -= TICK_DT;
    }
    render(accumulator / TICK_DT, frameDt);
  }

  requestAnimationFrame(frame);
}
