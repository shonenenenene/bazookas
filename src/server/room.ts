import { TICK_DT } from '../shared/config';
import type { GameMap } from '../shared/maps/types';
import { type Message, Reader, Writer } from '../shared/net/binary';
import {
  MSG, type TimedEvent, readCmd, writeJoin, writeLeave, writeMapChange, writePong, writeSnapshot, writeWelcome,
} from '../shared/net/protocol';
import { type UserCmd, copyUserCmd, createUserCmd } from '../shared/player';
import { type Player, type World, addPlayer, createWorld, playerThink, removePlayer, worldTick } from '../shared/world';
import { SERVER } from './config';
import { Match } from './match';

// ─────────────────────────────────────────────────────────────
// Комната: один мир и несколько игроков. Сервер здесь главный — он считает всё,
// а игрокам рассылает снимки мира. Клиенты присылают только свой ввод (команды).
//
// Команда игрока применяется, когда приходит (а не строго одна за тик): так у клиента
// получается ровно то же движение, что он предсказал у себя, и нет лишней задержки.
//
// В комнате идёт матч FFA (match.ts). Кончилась пауза с итогами — следующий матч: на другой карте (если сервер
// дал nextMap — все клиенты получают MAP и перезагружаются на неё) или на этой же (счёт с нуля).
// ─────────────────────────────────────────────────────────────

/** Куда отправлять сообщения игроку (обёртка над сокетом — так комнату можно проверять без сети). */
export interface ServerLink {
  send(data: Message): void;
}

export interface RoomOptions {
  /** Видна в списке комнат (лобби); иначе — только по ссылке */
  public?: boolean;
  /** Манекены с карты. Не задано — только на тренировочных картах (GameMap.training) */
  dummies?: boolean;
  /** Какая карта после этой (смена карт после матча). null или та же — следующий матч здесь же */
  nextMap?: (current: string) => string | null;
}

/** Комната в списке лобби */
export interface RoomInfo {
  name: string;
  map: string;
  players: number;
  max: number;
  phase: 'playing' | 'intermission';
  timeLeft: number;
  /** Лидер матча и его фраги (пусто, если никого) */
  leader: string;
  leaderFrags: number;
}

export interface RoomClient {
  link: ServerLink;
  player: Player;
  /** Пришедшие, но ещё не применённые команды */
  queue: { seq: number; cmd: UserCmd }[];
  /** Номер последней применённой команды — клиент сверяет по нему предсказание */
  ack: number;
  /** Сколько команд можно применить прямо сейчас (+1 за тик, см. SERVER.maxCmdBurst) */
  credits: number;
}

export class Room {
  readonly name: string;
  readonly world: World;
  readonly public: boolean;
  readonly match = new Match();
  /** Комната уходит на другую карту: клиентам отправлен MAP, новых не пускаем (main.ts закроет и удалит комнату) */
  closing = false;
  private nextMap: RoomOptions['nextMap'];
  private clients: RoomClient[] = [];
  /** События с прошлого снимка */
  private events: TimedEvent[] = [];
  private writer = new Writer();
  private reader = new Reader();

  constructor(name: string, map: GameMap, options: RoomOptions = {}) {
    this.name = name;
    this.public = options.public ?? false;
    this.nextMap = options.nextMap;
    this.world = createWorld(map, { dummies: options.dummies ?? map.training ?? false });
  }

  /** Сведения для списка комнат (лобби). */
  info(): RoomInfo {
    let leader = '';
    let leaderFrags = 0;
    for (const c of this.clients) {
      if (!leader || c.player.frags > leaderFrags) {
        leader = c.player.name;
        leaderFrags = c.player.frags;
      }
    }
    return {
      name: this.name, map: this.world.map.name, players: this.clients.length, max: SERVER.maxPlayers,
      phase: this.match.phase, timeLeft: Math.round(this.match.timeLeft), leader, leaderFrags,
    };
  }

  get size(): number {
    return this.clients.length;
  }

  /** Новый игрок. null — комната полна (или уходит на другую карту). */
  join(link: ServerLink, rawName: string): RoomClient | null {
    if (this.clients.length >= SERVER.maxPlayers || this.closing) return null;
    const player = addPlayer(this.world, cleanName(rawName), null);
    player.netControlled = true;
    const client: RoomClient = { link, player, queue: [], ack: 0, credits: 0 };

    writeWelcome(this.writer, this.world, player);
    link.send(this.writer.finish());
    writeJoin(this.writer, player);
    this.broadcast(this.writer.finish(), client);

    this.clients.push(client);
    return client;
  }

  leave(client: RoomClient): void {
    const i = this.clients.indexOf(client);
    if (i < 0) return;
    this.clients.splice(i, 1);
    removePlayer(this.world, client.player.id);
    writeLeave(this.writer, client.player.id);
    this.broadcast(this.writer.finish());
  }

  /** Сообщение от игрока. Битое или странное — молча игнорируем. */
  receive(client: RoomClient, data: Uint8Array): void {
    try {
      const r = this.reader.reset(data);
      switch (r.u8()) {
        case MSG.CMD: {
          const cmd = createUserCmd();
          const seq = readCmd(r, cmd);
          // Старые и повторные не нужны; лавину команд (читер) тоже не копим
          if (seq > client.ack && client.queue.length < 64) client.queue.push({ seq, cmd });
          break;
        }
        case MSG.PING:
          writePong(this.writer, r.f64());
          client.link.send(this.writer.finish());
          break;
      }
    } catch {
      // обрезанное сообщение и т.п.
    }
  }

  /** Один тик комнаты (60 раз в секунду). */
  tick(): void {
    if (this.closing) return;
    for (const c of this.clients) this.applyCommands(c);
    worldTick(this.world, TICK_DT); // манекены, ракеты, респауны

    for (const event of this.world.events) {
      this.events.push({ tick: this.world.tick, event });
      this.match.onEvent(this.world, event);
    }
    this.world.events.length = 0;

    // Пустую комнату (одни манекены) матч не крутит: время стоит, пока кто-нибудь не зайдёт
    if (this.clients.length > 0 && this.match.tick(TICK_DT) === 'next') this.nextMatch();

    if (this.world.tick % SERVER.snapshotEvery === 0) {
      const match = this.match.info();
      for (const c of this.clients) {
        writeSnapshot(this.writer, this.world, c.player, c.ack, this.events, match);
        c.link.send(this.writer.finish());
      }
      this.events.length = 0;
    }
  }

  /** Следующий матч: на другой карте (клиенты перезагрузятся на неё) или здесь же с нуля. */
  private nextMatch(): void {
    const next = this.nextMap?.(this.world.map.name);
    if (next && next !== this.world.map.name) {
      writeMapChange(this.writer, next);
      this.broadcast(this.writer.finish());
      this.closing = true;
      return;
    }
    this.match.restart(this.world);
  }

  /** Применить пришедшие команды игрока: не больше, чем позволяет запас (защита от ускорения). */
  private applyCommands(c: RoomClient): void {
    c.credits = Math.min(c.credits + 1, SERVER.maxCmdBurst);
    while (c.queue.length > 0 && c.credits >= 1) {
      const next = c.queue.shift()!;
      copyUserCmd(c.player.cmd, next.cmd);
      playerThink(this.world, c.player, TICK_DT);
      c.ack = next.seq;
      c.credits--;
    }
    // Очередь копится (клиент шлёт быстрее, чем мы применяем) — выбрасываем самые старые.
    // Клиент заметит по ack, что их не было, и поправит своё предсказание
    if (c.queue.length > SERVER.maxCmdQueue) {
      const dropped = c.queue.splice(0, c.queue.length - SERVER.maxCmdQueue);
      c.ack = dropped[dropped.length - 1].seq;
    }
  }

  private broadcast(data: Message, except?: RoomClient): void {
    for (const c of this.clients) if (c !== except) c.link.send(data);
  }
}

/** Ник без управляющих символов, до 16 знаков. Пустой — придумываем. */
function cleanName(raw: string): string {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return name || `n00b_${Math.floor(Math.random() * 1000)}`;
}
