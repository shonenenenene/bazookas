import { TICK_DT } from '../shared/config';
import { testMap } from '../shared/maps/testMap';
import { type Message, Reader, Writer } from '../shared/net/binary';
import {
  MSG, type TimedEvent, readCmd, writeJoin, writeLeave, writePong, writeSnapshot, writeWelcome,
} from '../shared/net/protocol';
import { type UserCmd, copyUserCmd, createUserCmd } from '../shared/player';
import { type Player, type World, addPlayer, createWorld, playerThink, removePlayer, worldTick } from '../shared/world';
import { SERVER } from './config';

// ─────────────────────────────────────────────────────────────
// Комната: один мир и несколько игроков. Сервер здесь главный — он считает всё,
// а игрокам рассылает снимки мира. Клиенты присылают только свой ввод (команды).
//
// Команда игрока применяется, когда приходит (а не строго одна за тик): так у клиента
// получается ровно то же движение, что он предсказал у себя, и нет лишней задержки.
// ─────────────────────────────────────────────────────────────

/** Куда отправлять сообщения игроку (обёртка над сокетом — так комнату можно проверять без сети). */
export interface ServerLink {
  send(data: Message): void;
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
  private clients: RoomClient[] = [];
  /** События с прошлого снимка */
  private events: TimedEvent[] = [];
  private writer = new Writer();
  private reader = new Reader();

  constructor(name: string) {
    this.name = name;
    this.world = createWorld(testMap, { dummies: SERVER.dummies });
  }

  get size(): number {
    return this.clients.length;
  }

  /** Новый игрок. null — комната полна. */
  join(link: ServerLink, rawName: string): RoomClient | null {
    if (this.clients.length >= SERVER.maxPlayers) return null;
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
    for (const c of this.clients) this.applyCommands(c);
    worldTick(this.world, TICK_DT); // манекены, ракеты, респауны

    for (const event of this.world.events) this.events.push({ tick: this.world.tick, event });
    this.world.events.length = 0;

    if (this.world.tick % SERVER.snapshotEvery === 0) {
      for (const c of this.clients) {
        writeSnapshot(this.writer, this.world, c.player, c.ack, this.events);
        c.link.send(this.writer.finish());
      }
      this.events.length = 0;
    }
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
