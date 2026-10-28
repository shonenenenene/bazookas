import { TICK_DT } from '../../shared/config';
import { CLIENT } from '../config';

// Плавная камера на ступеньках. Физика поднимает игрока на ступеньку за один тик (рывок на 16 юнитов),
// а камера догоняет тело равномерно за CLIENT.stepSmoothTime — как в Quake 3 (CG_StepOffset).
// На лестнице ступеньки идут чаще, чем камера успевает догнать, — остатки складываются,
// и камера поднимается ровно, без рывков.

export class StepSmooth {
  /** Сколько юнитов камере догонять на момент последней ступеньки (+ вверх, − вниз) */
  private change = 0;
  /** Ступенька последнего тика (0 — не было) */
  private lastStep = 0;
  /** Сколько тиков прошло с последней ступеньки */
  private ticksSince = 1000;

  /** Вызывать после каждого тика физики. step — Player.lastStep. */
  onTick(step: number): void {
    if (step === 0) {
      this.ticksSince++;
      this.lastStep = 0;
      return;
    }
    // Прошлая ступенька ещё не догнана — добавляем остаток к новой
    const left = this.change * this.fade(this.ticksSince + 1);
    const max = CLIENT.stepSmoothMax;
    this.change = Math.max(-max, Math.min(max, left + step));
    this.lastStep = step;
    this.ticksSince = 0;
  }

  /** Сдвиг камеры по высоте в этом кадре. alpha — как в игровом цикле (0..1 между тиками). */
  offset(alpha: number): number {
    let off = -this.change * this.fade(this.ticksSince + alpha);
    // В тике со ступенькой интерполяция позиции уже «размазала» часть рывка по кадрам.
    // Возвращаем рывок целиком — плавность даёт сдвиг выше, иначе камера на миг проседала бы
    if (this.ticksSince === 0) off += this.lastStep * (1 - alpha);
    return off;
  }

  /** Какая доля ступеньки ещё не догнана через `ticks` тиков после неё: 1 → 0. */
  private fade(ticks: number): number {
    if (CLIENT.stepSmoothTime <= 0) return 0;
    return Math.max(0, 1 - (ticks * TICK_DT) / CLIENT.stepSmoothTime);
  }
}
