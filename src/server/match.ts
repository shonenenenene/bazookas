import type { MatchInfo } from '../shared/net/protocol';
import { type GameEvent, type World, findPlayer, respawnPlayer } from '../shared/world';
import { SERVER } from './config';

// ─────────────────────────────────────────────────────────────
// Матч «каждый сам за себя» (FFA): фраги, лимит фрагов и времени, пауза с итогами между матчами.
// Счёт ведёт только сервер; клиентам он уходит в снимках (frags/deaths у игроков, MatchInfo в заголовке).
//
// Убил другого игрока — +1 фраг. Убил себя (своей ракетой) или упал в бездну — −1 (как в Quake).
// Манекены в счёте не участвуют: за них фрагов нет, их смерти не считаются.
// ─────────────────────────────────────────────────────────────

export class Match {
  phase: MatchInfo['phase'] = 'playing';
  /** Секунд до конца матча (или до следующего, если пауза) */
  timeLeft: number = SERVER.match.timeLimit;
  readonly fragLimit = SERVER.match.fragLimit;

  /** Посчитать событие мира (нас интересуют только убийства). */
  onEvent(world: World, e: GameEvent): void {
    if (e.type !== 'kill' || this.phase !== 'playing') return;
    const target = findPlayer(world, e.targetId);
    if (!target || target.bot) return;
    target.deaths++;
    const attacker = e.attackerId >= 0 ? findPlayer(world, e.attackerId) : undefined;
    if (!attacker || attacker === target) target.frags--; // сам себя / бездна
    else if (!attacker.bot) attacker.frags++;
    if (attacker && attacker !== target && attacker.frags >= this.fragLimit) this.end();
  }

  /**
   * Тик матча. 'next' — пауза с итогами кончилась: пора следующий матч (комната решает — на этой же карте
   * или на другой).
   */
  tick(dt: number): 'none' | 'next' {
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft > 0) return 'none';
    if (this.phase === 'playing') {
      this.end();
      return 'none';
    }
    return 'next';
  }

  /** Новый матч на той же карте: счёт с нуля, все — на точки появления. */
  restart(world: World): void {
    for (const p of world.players) {
      p.frags = 0;
      p.deaths = 0;
      respawnPlayer(world, p);
    }
    this.phase = 'playing';
    this.timeLeft = SERVER.match.timeLimit;
  }

  info(): MatchInfo {
    return { phase: this.phase, timeLeft: this.timeLeft, fragLimit: this.fragLimit };
  }

  private end(): void {
    this.phase = 'intermission';
    this.timeLeft = SERVER.match.intermission;
  }
}
