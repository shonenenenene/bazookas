import { vec3 } from '../shared/math';
import { type WeaponDef, WEAPONS } from '../shared/weapons';
import { type GameEvent, type Player, type Rocket, type World, findPlayer } from '../shared/world';
import type { Input } from './input';
import type { Particles } from './render/particles';
import type { PlayerMeshes } from './render/players';
import type { RocketView } from './render/rocketView';
import type { Viewmodel } from './render/viewmodel';
import type { Hud } from './ui/hud';

// Реакция клиента на события мира: взрывы, следы ракет, ошмётки, тряска камеры, HUD, искры над падами.
// Здесь только «красота»: на правила игры этот файл не влияет.

/** Строки ленты, когда убил не враг. {t} — кто погиб */
const SELF_KILL = ['{t} ate their own rocket', '{t} played themselves', '{t} forgot which end goes boom'];
const VOID_KILL = ['{t} fell into the void', '{t} found the edge of the world', '{t} rage quit (gravity)'];

const GIB_COLORS = [0xb3001b, 0x7a0010, 0xe9e1d3]; // кровь и «кости»

export class Effects {
  /** Сила тряски камеры, юниты */
  shake = 0;

  private world: World;
  private me: Player;
  private particles: Particles;
  private hud: Hud;
  private playerMeshes: PlayerMeshes;
  private viewmodel: Viewmodel;
  private input: Input;
  private rocketView: RocketView;
  private ticks = 0;
  private tmp = vec3();

  constructor(
    world: World, me: Player, particles: Particles, hud: Hud,
    playerMeshes: PlayerMeshes, viewmodel: Viewmodel, input: Input, rocketView: RocketView,
  ) {
    this.world = world;
    this.me = me;
    this.particles = particles;
    this.hud = hud;
    this.playerMeshes = playerMeshes;
    this.viewmodel = viewmodel;
    this.input = input;
    this.rocketView = rocketView;
  }

  /** Разобрать накопившиеся события мира. Вызывать после каждого тика. */
  handleEvents(): void {
    for (const e of this.world.events) this.handle(e);
    this.world.events.length = 0;
  }

  private handle(e: GameEvent): void {
    const me = this.me;
    switch (e.type) {
      case 'fire':
        if (e.playerId === me.id) {
          this.viewmodel.kick();
          this.hud.reload(WEAPONS[e.weapon].reload);
        }
        break;

      case 'explode':
        this.explosion(e.pos.x, e.pos.y, e.pos.z, WEAPONS[e.weapon]);
        break;

      case 'damage':
        this.playerMeshes.flash(e.targetId);
        if (e.targetId === me.id) {
          this.hud.hurt();
          this.shake += e.amount * 0.08;
        } else if (e.attackerId === me.id) {
          this.hud.hitmarker();
        }
        break;

      case 'kill':
        this.gibs(e.pos.x, e.pos.y, e.pos.z);
        this.killFeed(e.targetId, e.attackerId, e.weapon);
        if (e.targetId === me.id) this.hud.setDead(true);
        break;

      case 'spawn':
        if (e.playerId === me.id) {
          this.input.yaw = e.yaw;
          this.input.pitch = 0;
          this.hud.setDead(false);
          this.hud.resetTop();
        }
        break;
    }
  }

  /**
   * След за каждой ракетой: дымка цвета ракеты + искра. Вызывать после каждого тика.
   * Частицы складываются по яркости, поэтому их мало и они тусклые — иначе след сливается в пятно
   * (и слабой видеокарте тяжело закрашивать одни и те же пиксели много раз).
   */
  emitTrails(): void {
    for (const r of this.world.rockets) this.trail(r);
    for (const r of this.world.predictedRockets) this.trail(r);
  }

  private trail(r: Rocket): void {
    const color = WEAPONS[r.weapon].color;
    // Своя ракета на экране вылетает из ствола — и след тоже оттуда (см. rocketView.ts)
    const { x, y, z } = this.rocketView.position(this.tmp, r, Math.random(), r.ownerId === this.me.id);
    this.particles.spawn(x, y, z, rnd(15), 20 + rnd(10), rnd(15), 0.45, 10, color, 0.22); //  дымка
    this.particles.spawn(x, y, z, rnd(60), rnd(60), rnd(60), 0.15, 4, 0xfff2c0, 0.8); //       искра
  }

  /**
   * Искры над джамп-падами и пузырьки над бустерами — чтобы их было видно издалека.
   * Пузырьки летят на всей высоте зоны: видно, что бустер подхватит и в низком прыжке. Вызывать после каждого тика.
   */
  emitTriggerSparks(): void {
    if (++this.ticks % 3 !== 0) return; // хватит и 20–40 частиц в секунду на зону
    for (const t of this.world.map.triggers) {
      const x = t.min.x + Math.random() * (t.max.x - t.min.x);
      const z = t.min.z + Math.random() * (t.max.z - t.min.z);
      if (t.type === 'jumppad') {
        this.particles.spawn(x, t.min.y, z, 0, 160 + rnd(40), 0, 0.7, 6, 0x39ff14, 0.5);
        continue;
      }
      // Пузырьков — по одному на каждые ~130 юнитов полосы (полоса длинная, иначе их не видно)
      const area = (t.max.x - t.min.x) * (t.max.z - t.min.z);
      const count = Math.min(10, Math.ceil(area / 10000));
      for (let i = 0; i < count; i++) {
        const y = t.min.y + 3 + Math.random() * (t.max.y - t.min.y - 3);
        const bx = t.min.x + Math.random() * (t.max.x - t.min.x);
        const bz = t.min.z + Math.random() * (t.max.z - t.min.z);
        this.particles.spawn(bx, y, bz, t.dir.x * 350, 8 + rnd(8), t.dir.z * 350, 0.6, 6 + Math.random() * 4, 0xff1aa8, 0.7);
      }
    }
  }

  /** Затухание тряски; возвращает текущую силу. Вызывать раз в кадр. */
  updateShake(dt: number): number {
    this.shake = Math.min(this.shake, 14) * Math.exp(-dt * 8);
    return this.shake;
  }

  private explosion(x: number, y: number, z: number, w: WeaponDef): void {
    const p = this.particles;
    const r = w.splashRadius;
    p.spawn(x, y, z, 0, 0, 0, 0.1, r * 1.2, 0xfff2c0, 0.9); //                   вспышка
    p.spawn(x, y, z, 0, 0, 0, 0.25, r * 0.8, w.color, 0.6); //                   огненный шар
    for (let i = 0; i < 24; i++) {
      const s = 200 + Math.random() * 400;
      p.spawn(x, y, z, rnd(1) * s, rnd(1) * s + 120, rnd(1) * s, 0.3 + Math.random() * 0.4, 5 + Math.random() * 6, w.color, 1, 0.6); // искры
    }
    for (let i = 0; i < 5; i++) {
      p.spawn(x + rnd(r * 0.3), y + rnd(r * 0.2), z + rnd(r * 0.3), rnd(30), 40 + Math.random() * 40, rnd(30), 0.8 + Math.random() * 0.5, r * 0.45, 0x5a2a80, 0.25); // дымные клубы
    }

    // Тряска тем сильнее, чем ближе взрыв
    const o = this.me.state.origin;
    const dist = Math.hypot(o.x - x, o.y - y, o.z - z);
    this.shake += Math.max(0, 1 - dist / (r * 4)) * 6;
  }

  /** Ошмётки на месте смерти: красные и «костяные» брызги. */
  private gibs(x: number, y: number, z: number): void {
    for (let i = 0; i < 36; i++) {
      const color = GIB_COLORS[i % GIB_COLORS.length];
      this.particles.spawn(x, y, z, rnd(300), 150 + Math.random() * 350, rnd(300), 0.8 + Math.random() * 0.6, 7 + Math.random() * 6, color, 1, 1);
    }
  }

  private killFeed(targetId: number, attackerId: number, weapon: number): void {
    const target = findPlayer(this.world, targetId)?.name ?? '???';
    const attacker = findPlayer(this.world, attackerId)?.name ?? '???';
    let template: string;
    if (attackerId === -1) template = pick(VOID_KILL);
    else if (attackerId === targetId) template = pick(SELF_KILL);
    else template = WEAPONS[weapon]?.killMsg ?? '{a} killed {t}';
    this.hud.feed(template, attacker, target);
  }
}

/** Случайное число от −a до a */
function rnd(a: number): number {
  return (Math.random() * 2 - 1) * a;
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}
