import { MOVE } from '../../shared/config';
import type { PlayerState } from '../../shared/player';
import type { MatchInfo } from '../../shared/net/protocol';
import { WEAPONS } from '../../shared/weapons';
import type { Player } from '../../shared/world';

/**
 * HUD поверх игры: здоровье, базука и перезарядка, спидометр, лента убийств, отладочная строка.
 * Разметка — в index.html, стили — в main.css.
 *
 * Правило скорости: DOM трогаем только когда что-то изменилось (или 10 раз в секунду для спидометра).
 * Короткие анимации (перезарядка, вспышки) — через element.animate: их крутит браузер, а не наш код.
 */
export class Hud {
  private speedEl = byId('hud-speed');
  private topEl = byId('hud-top');
  private debugEl = byId('hud-debug');
  private healthEl = byId('hud-health');
  private healthBox = byId('hud-health-box');
  private weaponEl = byId('hud-weapon');
  private reloadEl = byId('hud-reload');
  private slotsEl = byId('hud-slots');
  private feedEl = byId('hud-feed');
  private deathEl = byId('hud-death');
  private hurtEl = byId('hud-hurt');
  private crosshairEl = byId('hud-crosshair');
  private wallJumpsEl = byId('hud-walljumps');
  private matchEl = byId('hud-match');
  private scoresEl = byId('hud-scores');
  private scoresTitleEl = byId('hud-scores-title');
  private scoresBodyEl = byId('hud-scores-body');
  private matchFrames = 0;
  private scoresShown = false;

  private shownWallJumps = -1; // −1 — ромбики спрятаны
  private shownSpread = 0;
  private shownHealth = -1;
  private shownWeapon = -1;
  private topSpeed = 0;
  private frames = 0;
  private elapsed = 0;
  private worstFrame = 0;

  constructor() {
    // Номера слотов под названием базуки: 1 2 3 4
    WEAPONS.forEach((w, i) => {
      if (w.hidden) return; // осколки — не базуки
      const slot = document.createElement('span');
      slot.textContent = String(i + 1);
      this.slotsEl.append(slot);
    });
    for (let i = 0; i < MOVE.wallJumpsPerAir; i++) this.wallJumpsEl.append(document.createElement('span'));
  }

  /**
   * Ромбики под прицелом: сколько отскоков от стены осталось до приземления. Видны в полёте, когда стену
   * уже коснулись или от неё отскочили. Звать каждый тик: DOM трогаем, только когда число поменялось.
   */
  wallJumps(ps: PlayerState): void {
    const shown = !ps.onGround && (ps.wallTouch || ps.wallJumps > 0);
    const left = shown ? MOVE.wallJumpsPerAir - ps.wallJumps : -1;
    if (left === this.shownWallJumps) return;
    this.shownWallJumps = left;
    this.wallJumpsEl.hidden = !shown;
    [...this.wallJumpsEl.children].forEach((el, i) => el.classList.toggle('on', i < left));
  }

  /**
   * Матч (в сети): строка сверху — свои фраги, место, время; таблица счёта — пока держишь Tab и в паузе с итогами.
   * Звать каждый кадр: DOM обновляется раз в 6 кадров (~10 раз в секунду) или когда таблица появилась/пропала.
   */
  match(m: MatchInfo, players: readonly Player[], isBot: (id: number) => boolean, meId: number, tabHeld: boolean): void {
    const showScores = tabHeld || m.phase === 'intermission';
    if (++this.matchFrames < 6 && showScores === this.scoresShown) return;
    this.matchFrames = 0;

    // Места: больше фрагов — выше, при равенстве — меньше смертей
    const rows = players.filter((p) => !isBot(p.id)).sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
    const mine = rows.findIndex((p) => p.id === meId);
    const me = rows[mine];
    this.matchEl.hidden = false;
    this.matchEl.textContent = m.phase === 'intermission'
      ? 'match over'
      : `${me?.frags ?? 0} frags · #${mine + 1}/${rows.length} · ${clock(m.timeLeft)} · to ${m.fragLimit}`;

    this.scoresShown = showScores;
    this.scoresEl.hidden = !showScores;
    if (!showScores) return;
    this.scoresTitleEl.textContent = m.phase === 'intermission'
      ? `${rows[0]?.name ?? 'nobody'} wins!!1 · next match in ${Math.ceil(m.timeLeft)}s`
      : `first 2 ${m.fragLimit} frags · ${clock(m.timeLeft)} left`;
    this.scoresBodyEl.replaceChildren(
      ...rows.map((p, i) => {
        const tr = document.createElement('tr');
        if (p.id === meId) tr.className = 'me';
        for (const text of [String(i + 1), p.name, String(p.frags), String(p.deaths)]) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.append(td);
        }
        return tr;
      }),
    );
  }

  /** Спидометр и отладка: каждый кадр копим, раз в 0.1 с пишем в DOM. ping — null в песочнице. */
  update(frameDt: number, speed: number, drawCalls: number, ping: number | null): void {
    this.topSpeed = Math.max(this.topSpeed, speed);
    this.frames++;
    this.elapsed += frameDt;
    this.worstFrame = Math.max(this.worstFrame, frameDt);
    if (this.elapsed < 0.1) return;

    this.speedEl.textContent = String(Math.round(speed));
    this.topEl.textContent = String(Math.round(this.topSpeed));
    const fps = Math.round(this.frames / this.elapsed);
    const worstMs = (this.worstFrame * 1000).toFixed(1);
    const net = ping === null ? '' : ` · ping ${Math.round(ping)}`;
    this.debugEl.textContent = `fps ${fps} · worst ${worstMs}ms · draw ${drawCalls}${net}`;

    this.frames = 0;
    this.elapsed = 0;
    this.worstFrame = 0;
  }

  /**
   * Полоски прицела разъезжаются от центра, когда базука разбросана частой стрельбой (deg — разброс в градусах).
   * DOM трогаем, только когда разница заметна (шаг 0.5°).
   */
  setSpread(deg: number): void {
    const step = Math.round(deg * 2) / 2;
    if (step === this.shownSpread) return;
    this.shownSpread = step;
    this.crosshairEl.style.setProperty('--gap', `${2 + step * 3}px`);
  }

  setHealth(hp: number): void {
    const value = Math.max(0, Math.ceil(hp));
    if (value === this.shownHealth) return;
    this.shownHealth = value;
    this.healthEl.textContent = String(value);
    this.healthBox.classList.toggle('low', value <= 30);
  }

  setWeapon(index: number): void {
    if (index === this.shownWeapon) return;
    this.shownWeapon = index;
    this.weaponEl.textContent = WEAPONS[index].name;
    [...this.slotsEl.children].forEach((el, i) => el.classList.toggle('active', i === index));
  }

  /** Полоска перезарядки заполняется за seconds. */
  reload(seconds: number): void {
    this.reloadEl.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
      duration: seconds * 1000,
      fill: 'forwards',
    });
  }

  /** Нам попали — красная вспышка по краям экрана. */
  hurt(): void {
    this.hurtEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: 'ease-out' });
  }

  /** Мы попали — прицел мигает. */
  hitmarker(): void {
    this.crosshairEl.animate([{ filter: 'hue-rotate(250deg) brightness(2)' }, { filter: 'none' }], { duration: 150 });
  }

  setDead(dead: boolean): void {
    this.deathEl.hidden = !dead;
  }

  resetTop(): void {
    this.topSpeed = 0;
  }

  /**
   * Строка в ленте убийств. template вида '{a} rocketed {t}'.
   * Имена вставляем через textContent — безопасно, даже когда имена придут от других игроков по сети.
   */
  feed(template: string, attacker: string, target: string): void {
    const line = document.createElement('div');
    for (const part of template.split(/(\{a\}|\{t\})/)) {
      if (part === '{a}' || part === '{t}') {
        const name = document.createElement('b');
        name.textContent = part === '{a}' ? attacker : target;
        line.append(name);
      } else if (part) {
        line.append(part);
      }
    }
    this.feedEl.prepend(line);
    while (this.feedEl.children.length > 5) this.feedEl.lastElementChild!.remove();
    setTimeout(() => line.remove(), 5000);
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`В index.html нет элемента #${id}`);
  return el;
}

/** Секунды → «8:05» */
function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
