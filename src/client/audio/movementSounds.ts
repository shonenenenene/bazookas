import { MOVE } from '../../shared/config';
import { length, lengthXZ } from '../../shared/math';
import type { PlayerState } from '../../shared/player';
import type { Sound } from './sound';

// Звуки своего движения. Движение событий не шлёт — поэтому каждый тик сравниваем состояние с прошлым:
// оторвались от земли — прыжок (удачный хоп, с пада), коснулись — приземление, стало больше отскоков — отскок,
// «остывание» отскока началось заново, а отскоков не прибавилось — отскок от серф-склона…

export class MovementSounds {
  private sound: Sound;
  private wasGround = true;
  private prevVy = 0;
  private prevWallJumps = 0;
  private prevWallCooldown = 0;
  private wasSliding = false;
  private ticks = 0;

  constructor(sound: Sound) {
    this.sound = sound;
  }

  /** Вызывать после каждого тика физики. */
  update(ps: PlayerState, dead: boolean): void {
    const s = this.sound;
    const v = ps.velocity;
    if (!dead) {
      if (this.wasGround && !ps.onGround && v.y > 100 && ps.knockbackTime === 0) {
        // Оторвались вверх, и это не взрыв: с пада (прыжок выше обычного), удачный хоп или просто прыжок
        if (v.y > MOVE.jumpVelocity * 1.5) s.pad();
        else if (ps.groundTicks <= MOVE.hopWindow) s.hop(lengthXZ(v));
        else s.jump();
      }
      if (!this.wasGround && ps.onGround) s.land(-this.prevVy);
      if (ps.wallJumps > this.prevWallJumps) s.wallJump(ps.wallTime <= MOVE.wallJumpWindow);
      else if (ps.wallCooldown > this.prevWallCooldown) s.hop(lengthXZ(v)); // отскок от склона — разгон, как хоп
      if (ps.sliding && !this.wasSliding) s.slide();
    }
    // Ветер — 20 раз в секунду хватит (он и так плавный)
    if (++this.ticks % 3 === 0) s.wind(dead ? 0 : length(v));

    this.wasGround = ps.onGround;
    this.prevVy = v.y;
    this.prevWallJumps = ps.wallJumps;
    this.prevWallCooldown = ps.wallCooldown;
    this.wasSliding = ps.sliding;
  }
}
