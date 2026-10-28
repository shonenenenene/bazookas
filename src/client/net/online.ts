import { TICK_RATE } from '../../shared/config';
import { Reader, Writer } from '../../shared/net/binary';
import { MSG, type PlayerInfo, type TimedEvent, readPlayerInfo, readSnapshot, writePing } from '../../shared/net/protocol';
import { type Player, type World, addPlayer, findPlayer, removePlayer } from '../../shared/world';
import { Interpolator } from './interpolation';
import { type CmdSink, type CmdSource, Predictor } from './prediction';

// ─────────────────────────────────────────────────────────────
// Сетевая игра на стороне клиента. Каждый тик:
//  1) разбираем сообщения сервера (кто зашёл / вышел, снимки мира);
//  2) чужих игроков и ракеты ставим по снимкам — чуть в прошлом, зато плавно (interpolation.ts);
//  3) своё движение не ждём от сервера, а предсказываем сами (prediction.ts).
// События мира (взрывы, убийства) кладём в world.events — их, как и в песочнице, рисует effects.ts.
//
// Файл не трогает DOM, поэтому автопроверки гоняют его без браузера (tests/net.ts).
// ─────────────────────────────────────────────────────────────

/** Канал до сервера: WebSocket (connection.ts) или подделка в автопроверках. */
export interface NetLink extends CmdSink {
  /** Пришедшие сообщения; сессия забирает их в начале тика */
  readonly inbox: (ArrayBuffer | Uint8Array)[];
}

export class OnlineSession {
  /** Пинг до сервера (туда и обратно), мс */
  ping = 0;
  /** Сервер прислал приветствие и первый снимок — играем */
  ready = false;
  /** Вызывается, когда кто-то зашёл или вышел (для меню) */
  onRoster: () => void = () => {};
  readonly predictor: Predictor;

  private world: World;
  private me: Player;
  private link: NetLink;
  private interp = new Interpolator();
  private reader = new Reader();
  private writer = new Writer(16);
  /** События чужого мира ждут своего момента: показываем их в том же «прошлом», что и игроков */
  private delayed: TimedEvent[] = [];
  private bots = new Set<number>();
  private welcomed = false;
  private ticks = 0;

  constructor(world: World, me: Player, link: NetLink) {
    this.world = world;
    this.me = me;
    this.link = link;
    this.predictor = new Predictor(world, me, link);
  }

  /** Сколько живых людей в комнате (вместе с нами, без манекенов). */
  get humans(): number {
    return this.world.players.length - this.bots.size;
  }

  /** Один тик клиента (60 раз в секунду). */
  tick(input: CmdSource): void {
    for (const data of this.link.inbox) this.handle(data);
    this.link.inbox.length = 0;
    if (!this.ready) return;

    this.interp.update(this.world, this.me.id);
    this.releaseEvents();
    this.predictor.predict(input);

    // Раз в секунду меряем пинг
    if (++this.ticks % TICK_RATE === 0) {
      writePing(this.writer, performance.now());
      this.link.send(this.writer.finish());
    }
  }

  private handle(data: ArrayBuffer | Uint8Array): void {
    const r = this.reader.reset(data);
    switch (r.u8()) {
      case MSG.WELCOME: {
        this.me.id = r.u32(); // наш номер раздаёт сервер
        const count = r.u8();
        for (let i = 0; i < count; i++) this.addRemote(readPlayerInfo(r));
        this.welcomed = true;
        this.onRoster();
        break;
      }
      case MSG.JOIN:
        this.addRemote(readPlayerInfo(r));
        this.onRoster();
        break;
      case MSG.LEAVE: {
        const id = r.u32();
        removePlayer(this.world, id);
        this.bots.delete(id);
        this.onRoster();
        break;
      }
      case MSG.SNAPSHOT: {
        if (!this.welcomed) break;
        const snap = this.interp.next();
        readSnapshot(r, snap);
        this.interp.commit(snap);
        this.predictor.reconcile(snap);
        this.queueEvents(snap.events);
        this.ready = true;
        break;
      }
      case MSG.PONG:
        this.ping = performance.now() - r.f64();
        break;
    }
  }

  private addRemote(info: PlayerInfo): void {
    if (info.id === this.me.id || findPlayer(this.world, info.id)) return;
    const p = addPlayer(this.world, info.name, null, null, info.id);
    p.dead = true; // не рисуем, пока не появится в снимке
    if (info.bot) this.bots.add(info.id);
  }

  /**
   * Что касается нас самих, показываем сразу: мы живём «в настоящем» (своё движение предсказано).
   * Остальное — когда до этого момента дойдёт картинка чужого мира.
   */
  private queueEvents(events: TimedEvent[]): void {
    const id = this.me.id;
    for (const te of events) {
      const e = te.event;
      if (e.type === 'fire' && e.playerId === id) continue; // свой выстрел уже показали при предсказании
      if (e.type === 'explode' && e.ownerId === id) {
        // Свою ракету мы запустили сами. Ещё летит — взрываем там, где взорвал сервер (он главный:
        // например, попал в игрока, которого у нас не задело). Уже взорвалась у нас — второй взрыв не нужен
        const rockets = this.world.predictedRockets;
        const i = rockets.findIndex((r) => r.serial === e.serial);
        if (i >= 0) {
          rockets.splice(i, 1);
          this.world.events.push(e);
        }
        continue;
      }
      const mine =
        (e.type === 'spawn' && e.playerId === id) ||
        (e.type === 'damage' && (e.targetId === id || e.attackerId === id)) ||
        (e.type === 'kill' && e.targetId === id);
      if (mine) this.world.events.push(e);
      else this.delayed.push(te);
    }
  }

  private releaseEvents(): void {
    let kept = 0;
    for (const te of this.delayed) {
      if (te.tick <= this.interp.renderTick) this.world.events.push(te.event);
      else this.delayed[kept++] = te;
    }
    this.delayed.length = kept;
  }
}
