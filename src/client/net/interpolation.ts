import { TICK_RATE } from '../../shared/config';
import { copy, distSq, lerp, vec3 } from '../../shared/math';
import { type NetPlayer, type NetRocket, type Snapshot, createSnapshot } from '../../shared/net/protocol';
import { WEAPONS } from '../../shared/weapons';
import type { Rocket, World } from '../../shared/world';
import { CLIENT } from '../config';

// ─────────────────────────────────────────────────────────────
// Чужие игроки и ракеты по снимкам сервера (интерполяция).
// Снимки приходят 30 раз в секунду, и то неровно. Поэтому показываем мир чуть в прошлом
// (CLIENT.interpDelay, ~0.1 с): тогда у нас почти всегда есть снимок «до» и снимок «после»,
// и между ними можно плавно провести линию.
// ─────────────────────────────────────────────────────────────

/** Сколько последних снимков храним */
const RING = 32;
/** Если между снимками сдвинулись дальше этого — это респаун или телепорт: не размазываем движение */
const TELEPORT_DIST = 200;

export class Interpolator {
  /** Какой тик сервера сейчас на экране (дробный) */
  renderTick = 0;

  private snaps: Snapshot[] = Array.from({ length: RING }, createSnapshot);
  private newest = -1;
  private count = 0;
  /** Ракеты на экране по id. Объекты переиспользуем, чтобы не плодить мусор */
  private rockets = new Map<number, Rocket>();
  private rocketPool: Rocket[] = [];
  private seen = new Set<number>();
  private tmp = vec3();

  /** Пустой снимок, куда читать следующий пришедший. */
  next(): Snapshot {
    return this.snaps[(this.newest + 1) % RING];
  }

  /** Снимок прочитан — запомнить и подстроить часы. */
  commit(snap: Snapshot): void {
    this.newest = (this.newest + 1) % RING;
    this.count = Math.min(this.count + 1, RING);

    // Хотим отставать от свежего снимка ровно на interpDelay. Сеть то ускоряется, то тормозит —
    // поэтому часы подкручиваем понемногу, а сильно разошлись — переставляем сразу
    const target = snap.tick - CLIENT.interpDelay * TICK_RATE;
    if (this.count === 1 || Math.abs(target - this.renderTick) > TICK_RATE / 2) this.renderTick = target;
    else this.renderTick += (target - this.renderTick) * 0.1;
  }

  /** Тик клиента: сдвинуть время и расставить чужих игроков и ракеты. meId — себя не трогаем. */
  update(world: World, meId: number): void {
    if (this.count === 0) return;
    const newest = this.snaps[this.newest];
    // В будущее не заглядываем: снимок запаздывает — ждём его на месте
    this.renderTick = Math.min(this.renderTick + 1, newest.tick);

    // Пара снимков вокруг renderTick: a — последний не позже, b — следующий за ним
    let a = newest;
    let b = newest;
    for (let i = 0; i < this.count; i++) {
      const s = this.snaps[(this.newest - i + RING) % RING];
      a = s;
      if (s.tick <= this.renderTick) break;
      b = s;
    }
    const t = b.tick > a.tick ? Math.min(Math.max((this.renderTick - a.tick) / (b.tick - a.tick), 0), 1) : 0;

    this.updatePlayers(world, meId, a, b, t);
    this.updateRockets(world, meId, a, b, t);
  }

  private updatePlayers(world: World, meId: number, a: Snapshot, b: Snapshot, t: number): void {
    for (const p of world.players) {
      if (p.id === meId) continue;
      const pb = findPlayer(b, p.id);
      if (!pb) {
        p.dead = true; // ещё (или уже) нет в снимках — не рисуем
        continue;
      }
      const pa = findPlayer(a, p.id) ?? pb;
      copy(p.prevOrigin, p.state.origin);

      // Умер, ожил или телепортировался между снимками — берём ближайший снимок целиком
      const jump = pa.dead !== pb.dead || distSq(pa.pos, pb.pos) > TELEPORT_DIST * TELEPORT_DIST;
      if (jump) {
        const src = t < 0.5 ? pa : pb;
        copy(p.state.origin, src.pos);
        p.dead = src.dead;
        p.cmd.yaw = src.yaw;
        p.cmd.pitch = src.pitch;
      } else {
        lerp(p.state.origin, pa.pos, pb.pos, t);
        p.dead = pa.dead;
        p.cmd.yaw = pa.yaw + (pb.yaw - pa.yaw) * t;
        p.cmd.pitch = pa.pitch + (pb.pitch - pa.pitch) * t;
      }
      p.weapon = pb.weapon;
      p.state.crouched = pb.crouched;
      // Прыжок через полкарты не рисуем «пролётом» между кадрами
      if (distSq(p.prevOrigin, p.state.origin) > TELEPORT_DIST * TELEPORT_DIST) copy(p.prevOrigin, p.state.origin);
    }
  }

  /** Чужие ракеты (свои мы запускаем сами — см. prediction.ts). */
  private updateRockets(world: World, meId: number, a: Snapshot, b: Snapshot, t: number): void {
    world.rockets.length = 0;
    this.seen.clear();
    for (let i = 0; i < b.rocketCount; i++) {
      const rb = b.rockets[i];
      if (rb.ownerId === meId && !WEAPONS[rb.weapon].hidden) continue; // свою ракету рисуем предсказанной; осколки — нет
      const ra = findRocket(a, rb.id);
      // Ракета появилась между снимками — покажем со следующего тика, когда будет откуда лететь
      if (!ra && a !== b) continue;
      const pos = ra ? lerp(this.tmp, ra.pos, rb.pos, t) : rb.pos;

      let r = this.rockets.get(rb.id);
      if (r) {
        copy(r.prevPos, r.pos);
        copy(r.pos, pos);
      } else {
        r = this.rocketPool.pop() ?? { id: 0, ownerId: -1, serial: 0, weapon: 0, pos: vec3(), prevPos: vec3(), vel: vec3(), age: 0, bounces: 0 };
        r.id = rb.id;
        r.ownerId = rb.ownerId;
        r.weapon = rb.weapon;
        copy(r.pos, pos);
        copy(r.prevPos, pos);
        this.rockets.set(rb.id, r);
      }
      world.rockets.push(r);
      this.seen.add(rb.id);
    }
    // Взорвавшиеся — обратно в запас
    for (const [id, r] of this.rockets) {
      if (this.seen.has(id)) continue;
      this.rockets.delete(id);
      this.rocketPool.push(r);
    }
  }
}

function findPlayer(s: Snapshot, id: number): NetPlayer | undefined {
  for (let i = 0; i < s.playerCount; i++) if (s.players[i].id === id) return s.players[i];
  return undefined;
}

function findRocket(s: Snapshot, id: number): NetRocket | undefined {
  for (let i = 0; i < s.rocketCount; i++) if (s.rockets[i].id === id) return s.rockets[i];
  return undefined;
}
