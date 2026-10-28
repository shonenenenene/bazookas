import type { UserCmd } from '../shared/player';
import { WEAPONS } from '../shared/weapons';
import { CLIENT } from './config';

const DEG = Math.PI / 180;
const MAX_PITCH = 89 * DEG;
/** Множитель из Quake: поворот в градусах = пиксели мыши × sensitivity × 0.022 */
const M_YAW = 0.022;

/**
 * Клавиатура и мышь.
 * Мышь поворачивает взгляд сразу, не дожидаясь тика физики — так управление ощущается мгновенным.
 * Клавиши читаем по e.code (физическая клавиша), поэтому WASD работает и на русской раскладке.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  /** Выбранная базука (индекс в WEAPONS) */
  weapon = 0;
  private keys = new Set<string>();
  private firing = false;
  private lastWheel = 0;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault(); // чтобы страница не прокручивалась
      // Цифры 1–9 — выбор базуки
      if (e.code.startsWith('Digit')) this.selectWeapon(Number(e.code.slice(5)) - 1);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      // ушли из окна — «отпускаем» все клавиши
      this.keys.clear();
      this.firing = false;
    });
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.firing = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    document.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
  }

  /** Мышь захвачена игрой (идёт игра, а не меню). */
  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Захватить мышь. Сначала просим «сырой» ввод без ускорения курсора Windows, если браузер умеет. */
  async lockPointer(): Promise<void> {
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await this.canvas.requestPointerLock();
      } catch {
        // Браузер не дал захват (например, слишком быстро после Esc) — игрок кликнет ещё раз
      }
    }
  }

  private selectWeapon(index: number): void {
    if (index >= 0 && index < WEAPONS.length) this.weapon = index;
  }

  private onWheel(e: WheelEvent): void {
    if (!this.locked || e.deltaY === 0) return;
    // Тачпады шлют десятки событий за раз — переключаем не чаще раза в 120 мс
    const now = performance.now();
    if (now - this.lastWheel < 120) return;
    this.lastWheel = now;
    const step = e.deltaY > 0 ? 1 : -1;
    this.weapon = (this.weapon + step + WEAPONS.length) % WEAPONS.length;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.locked) return;
    const k = CLIENT.mouseSensitivity * M_YAW * DEG;
    this.yaw -= e.movementX * k;
    this.pitch -= e.movementY * k * (CLIENT.invertY ? -1 : 1);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  /** Заполнить команду для очередного тика физики. */
  fillCmd(cmd: UserCmd): void {
    const k = this.keys;
    const active = this.locked;
    cmd.forward = active ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : 0;
    cmd.right = active ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : 0;
    cmd.jump = active && k.has('Space');
    cmd.fire = active && this.firing;
    cmd.weapon = this.weapon;
    cmd.yaw = this.yaw;
    cmd.pitch = this.pitch;
  }
}
