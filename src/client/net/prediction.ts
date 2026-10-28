import { applyKnockback, moveRockets, splashDamage } from '../../shared/combat';
import { TICK_DT } from '../../shared/config';
import { type Vec3, addScaled, copy, length, scale, set, sub, vec3 } from '../../shared/math';
import { type Message, Writer } from '../../shared/net/binary';
import { type NetMe, type Snapshot, quantizeCmd, writeCmd } from '../../shared/net/protocol';
import { type UserCmd, copyUserCmd, createUserCmd } from '../../shared/player';
import { WEAPONS } from '../../shared/weapons';
import { type Player, type World, playerThink } from '../../shared/world';

// ─────────────────────────────────────────────────────────────
// Предсказание своего движения. Ответа сервера не ждём: каждый тик сразу двигаемся сами
// тем же кодом, что и сервер (playerThink), — поэтому управление без задержки при любом пинге.
//
// Сверка: в снимке сервер присылает наше состояние после команды №ack. Берём его за основу
// и заново прогоняем команды, которые сервер ещё не применил. Обычно получается то же самое,
// что мы и так предсказали. Если нет (например, нас толкнул чужой взрыв) — разницу
// прячем: камера доезжает до правильного места плавно, а не прыгает.
//
// Свои ракеты тоже не ждём: они вылетают у нас сразу (world.predictedRockets), а их взрыв рядом
// толкает нас — рокет-джамп срабатывает без задержки пинга. Урон всё равно считает сервер.
// ─────────────────────────────────────────────────────────────

/** Сколько последних команд помним (~2 секунды) — больше неподтверждённых при нормальном пинге не бывает */
const HISTORY = 128;
/** Расхождение больше этого — респаун или телепорт: не сглаживаем, а сразу ставим камеру куда надо */
const SNAP_DIST = 64;
/** Как быстро гаснет сглаживание расхождения (больше — быстрее) */
const ERROR_DECAY = 12;
/** Свой толчок, который сервер так и не подтвердил за столько тиков, забываем (сервер главный) */
const PUSH_TTL = 30;

/** Канал до сервера (WebSocket или подделка в автопроверках). */
export interface CmdSink {
  send(data: Message): void;
}

/** Откуда берётся ввод игрока (Input или сценарий в автопроверках). */
export interface CmdSource {
  fillCmd(cmd: UserCmd): void;
}

/** Толчок от своего взрыва, который сервер ещё не подтвердил: при сверке его надо повторить. */
interface PendingPush {
  /** После какой команды он случился */
  seq: number;
  /** Какая наша ракета взорвалась (Rocket.serial) */
  serial: number;
  dir: Vec3;
  damage: number;
  knockback: number;
}

export class Predictor {
  /** Сдвиг камеры, который прячет расхождение с сервером. Плавно гаснет до нуля */
  readonly error = vec3();
  /** Самая большая поправка с прошлого сброса — для отладки и автопроверок */
  largestCorrection = 0;

  private world: World;
  private me: Player;
  private link: CmdSink;
  /** Кольцо команд: команда №seq лежит в ячейке seq % HISTORY */
  private cmds: UserCmd[] = Array.from({ length: HISTORY }, createUserCmd);
  private seq = 0;
  private acked = 0;
  private pushes: PendingPush[] = [];
  private writer = new Writer(64);
  private before = vec3();
  private diff = vec3();

  constructor(world: World, me: Player, link: CmdSink) {
    this.world = world;
    this.me = me;
    this.link = link;
  }

  /** Новый тик: считать ввод, отправить серверу и сразу применить у себя. */
  predict(input: CmdSource): void {
    const cmd = this.cmds[++this.seq % HISTORY];
    input.fillCmd(cmd);
    quantizeCmd(cmd); // применяем ровно то, что получит сервер
    writeCmd(this.writer, this.seq, cmd);
    this.link.send(this.writer.finish());

    copy(this.me.prevOrigin, this.me.state.origin);
    this.run(cmd);

    // Свои ракеты летят у нас сразу. Взорвалась рядом — толкает нас (как на сервере: после хода игрока)
    const world = this.world;
    const eventsBefore = world.events.length;
    moveRockets(world, world.predictedRockets, TICK_DT);
    for (let i = eventsBefore; i < world.events.length; i++) {
      const e = world.events[i];
      if (e.type === 'explode' && e.ownerId === this.me.id) this.predictPush(e.pos, e.weapon, e.serial);
    }
  }

  /** Пришёл снимок: встаём туда, где нас видит сервер, и повторяем неподтверждённые команды. */
  reconcile(snap: Snapshot): void {
    if (snap.ack < this.acked) return;
    this.acked = snap.ack;
    const me = this.me;
    const world = this.world;
    this.forgetPushes(snap);
    copy(this.before, me.state.origin);

    applyServerState(me, snap.me);
    // Повторяем команды. События (выстрелы) и ракеты при повторе уже были — выкидываем дубли
    const eventsBefore = world.events.length;
    const rocketsBefore = world.predictedRockets.length;
    // Толчки, случившиеся у нас раньше, чем сервер дошёл до них, — сразу
    for (const p of this.pushes) if (p.seq <= snap.ack) this.applyPush(p);
    for (let s = Math.max(snap.ack + 1, this.seq - HISTORY + 1); s <= this.seq; s++) {
      this.run(this.cmds[s % HISTORY]);
      for (const p of this.pushes) if (p.seq === s) this.applyPush(p);
    }
    world.events.length = eventsBefore;
    world.predictedRockets.length = rocketsBefore;

    // Насколько сервер поправил наше предсказание
    sub(this.diff, this.before, me.state.origin);
    const correction = length(this.diff);
    this.largestCorrection = Math.max(this.largestCorrection, correction);
    addScaled(this.error, this.error, this.diff, 1);
    if (correction > SNAP_DIST || length(this.error) > SNAP_DIST) set(this.error, 0, 0, 0);
  }

  /** Сдвиг камеры в этом кадре (гаснет со временем). Вызывать раз в кадр. */
  smooth(frameDt: number): Vec3 {
    scale(this.error, this.error, Math.exp(-frameDt * ERROR_DECAY));
    return this.error;
  }

  private run(cmd: UserCmd): void {
    copyUserCmd(this.me.cmd, cmd);
    playerThink(this.world, this.me, TICK_DT);
  }

  /** Своя ракета взорвалась у нас: толкаем себя так же, как это сделает сервер, и запоминаем толчок. */
  private predictPush(pos: Vec3, weapon: number, serial: number): void {
    if (this.me.dead) return;
    const w = WEAPONS[weapon];
    const dir = vec3();
    const damage = splashDamage(this.world, pos, w, this.me, dir);
    if (damage <= 0) return;
    const push: PendingPush = { seq: this.seq, serial, dir, damage, knockback: w.knockback };
    this.applyPush(push);
    this.pushes.push(push);
  }

  private applyPush(p: PendingPush): void {
    applyKnockback(this.me.state, p.dir, p.damage, p.knockback);
  }

  /** Сервер прислал взрыв нашей ракеты — его толчок уже в серверном состоянии, свой повторять не надо. */
  private forgetPushes(snap: Snapshot): void {
    const id = this.me.id;
    let kept = 0;
    for (const p of this.pushes) {
      let confirmed = p.seq < this.seq - PUSH_TTL;
      for (const te of snap.events) {
        const e = te.event;
        if (e.type === 'explode' && e.ownerId === id && e.serial === p.serial) confirmed = true;
      }
      if (!confirmed) this.pushes[kept++] = p;
    }
    this.pushes.length = kept;
  }
}

/** Своё состояние из снимка сервера. */
function applyServerState(me: Player, s: NetMe): void {
  const ps = me.state;
  copy(ps.origin, s.origin);
  copy(ps.velocity, s.velocity);
  ps.onGround = s.onGround;
  ps.jumpDown = s.jumpDown;
  ps.jumpBuffer = s.jumpBuffer;
  ps.knockbackTime = s.knockbackTime;
  ps.groundTicks = s.groundTicks;
  ps.crouched = s.crouched;
  ps.sliding = s.sliding;
  ps.slideCooldown = s.slideCooldown;
  ps.wallTouch = s.wallTouch;
  ps.wallTime = s.wallTime;
  ps.wallSpeed = s.wallSpeed;
  ps.wallJumps = s.wallJumps;
  copy(ps.wallNormal, s.wallNormal);
  ps.wallCooldown = s.wallCooldown;
  // groundNormal не присылаем: движение пересчитывает его в начале каждого тика
  me.cooldown = s.cooldown;
  me.weapon = s.weapon;
  me.rocketsFired = s.rocketsFired;
  me.health = s.health;
  me.dead = s.dead;
}
