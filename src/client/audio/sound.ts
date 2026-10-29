import type { Vec3 } from '../../shared/math';
import type { WeaponDef } from '../../shared/weapons';
import { CLIENT } from '../config';

// Все звуки игры. Синтезируются прямо в браузере (Web Audio): шум, генераторы тона, фильтры и перегруз —
// без звуковых файлов и библиотек. Звук считает браузер в своём потоке, на FPS это почти не влияет.
//
// Чужие звуки (выстрелы, взрывы) «стоят» в мире: слышно, с какой стороны и как далеко. Свои — прямо в ушах.
// Тип выстрела берётся из WeaponDef.fireSound, особый звук взрыва — из WeaponDef.explodeSound.
// Каждый звук — это несколько узлов Web Audio, которые живут доли секунды и удаляются браузером сами.

/** Насколько громко звук вблизи и как быстро тихнет с расстоянием (юниты Quake) */
const NEAR = 150;
const FAR = 4000;

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** Секунда белого шума — из неё делаются взрывы, шипение, свист */
  private noise!: AudioBuffer;
  /** Кривая перегруза: «рвёт» звук, как гитарный дисторшн (взрывы, скрим) */
  private crunchCurve!: Float32Array<ArrayBuffer>;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;

  /** Включить звук. Браузер разрешает это только после клика игрока — поэтому зовём из меню. */
  resume(): void {
    if (!this.ctx) this.init();
    void this.ctx!.resume();
  }

  private init(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = CLIENT.volume;
    // Ограничитель громкости: десять взрывов разом не должны рвать колонки
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 12;
    this.master.connect(limiter).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.crunchCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      this.crunchCurve[i] = Math.tanh(x * 6);
    }

    // Ветер: «коричневый» шум (белый, сглаженный — почти без высоких частот, гул вместо шипения)
    // по кругу через фильтр низких частот; громкость и «высота» растут со скоростью (см. wind).
    // Медленный генератор (0.25 Гц) раскачивает фильтр — получаются порывы
    const brown = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const bd = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bd.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      bd[i] = last * 3.5;
    }
    const wind = ctx.createBufferSource();
    wind.buffer = brown;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const gusts = ctx.createOscillator();
    gusts.frequency.value = 0.25;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 70; // ± 70 Гц к частоте фильтра
    gusts.connect(gustDepth).connect(this.windFilter.frequency);
    gusts.start();
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
  }

  /** Где уши: камера (позиция и куда смотрим). Раз в кадр. */
  listen(pos: Vec3, fx: number, fy: number, fz: number): void {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      // Старые браузеры (Firefox) — через устаревшие методы
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Гул ветра: тихо на беге, громче на банни-хопе, серфе и рокет-джампе. speed — u/s. */
  wind(speed: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.min(Math.max((speed - 380) / 700, 0), 1);
    this.windGain.gain.setTargetAtTime(k * k * 0.4, t, 0.15); // низкие частоты на слух тише — громкость чуть больше
    this.windFilter.frequency.setTargetAtTime(160 + Math.min(speed, 1600) * 0.3, t, 0.15); // 160…640 Гц, без шипения
  }

  // ─── Бой ──────────────────────────────────────────────────

  /** Выстрел — по WeaponDef.fireSound. pos — null для своего. */
  fire(w: WeaponDef, pos: Vec3 | null): void {
    const dest = this.out(pos);
    if (!dest) return;
    if (w.fireSound === 'pistol') {
      // «Дигл»: хлёсткий треск + короткий удар, через перегруз
      this.burst(this.crunch(dest, 0.5), 0.12, 0.8, 'highpass', 3000, 1200, 0.7);
      this.tone(dest, 'sine', 180, 60, 0.12, 0.7);
      return;
    }
    if (w.fireSound === 'blade') {
      // Выкидной нож: щелчок пружины + металлический «вжик» (звон с понижением) + глухой толчок трубы
      this.burst(dest, 0.03, 0.5, 'highpass', 6000, 4000, 0.8);
      this.metal(dest, 2400, 0.35, 0.35, 0.02, 0.85);
      this.tone(dest, 'sine', 200, 80, 0.12, 0.45);
      return;
    }
    if (w.fireSound === 'thump') {
      // Гранатомёт: глухой «бульк» трубы
      this.tone(dest, 'sine', 220, 70, 0.16, 0.7);
      this.burst(dest, 0.1, 0.3, 'lowpass', 900, 300, 1);
      return;
    }
    // Ракета: шипение вылета + «бух» трубы. Чем быстрее ракета, тем выше звук
    const p = w.speed / 1000;
    for (let i = 0; i < w.rockets; i++) {
      const d = i * 0.045; // Spam Can: три ракеты — три «пшика» подряд
      this.burst(dest, 0.25, 0.45, 'bandpass', 1800 * p, 300 * p, 1.2, d);
      this.tone(dest, 'sine', 140, 50, 0.18, 0.6, d);
    }
  }

  /** Взрыв: рваный шум, который глохнет, + низкий удар. Размер — по радиусу взрыва. */
  explode(w: WeaponDef, pos: Vec3): void {
    const dest = this.out(pos);
    if (!dest) return;
    const size = w.splashRadius / 130;
    this.burst(this.crunch(dest, 0.6), 0.35 + 0.6 * size, 1, 'lowpass', 2600, 120, 0.7);
    this.tone(dest, 'sine', 95, 32, 0.25 + 0.35 * size, 0.9);
    if (w.explodeSound === 'blades') {
      // Ножи разлетаются: россыпь звонов разной высоты одна за другой
      for (let i = 0; i < 5; i++) this.metal(dest, 2600 + i * 430, 0.3, 0.16, i * 0.025, 0.9);
    }
  }

  /** Нож воткнулся: короткое «дзынь». Ножей бывает десяток разом — звеним не чаще раза в 40 мс. */
  knifeHit(pos: Vec3): void {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.lastKnife < 0.04) return;
    this.lastKnife = ctx.currentTime;
    const dest = this.out(pos);
    if (!dest) return;
    this.burst(dest, 0.02, 0.35, 'highpass', 5000, 3500, 0.8); // удар острия
    this.metal(dest, 3200 + Math.random() * 1400, 0.22, 0.14, 0, 1);
  }

  private lastKnife = 0;

  /**
   * Металлический звон: несколько синусов с «нечётными» соотношениями частот (как у колокольчика или клинка),
   * быстро гаснут. bend — во сколько раз частота уходит за время звучания (0.85 — «вжик» вниз, 1 — ровно).
   */
  private metal(dest: AudioNode, f: number, dur: number, vol: number, delay: number, bend: number): void {
    const partials: [number, number][] = [[1, 1], [1.51, 0.6], [2.37, 0.4], [3.13, 0.25]];
    for (const [ratio, gain] of partials) this.tone(dest, 'sine', f * ratio, f * ratio * bend, dur / ratio ** 0.3, vol * gain, delay);
  }

  /** Нам попали: глухой рык. */
  hurt(): void {
    if (!this.ctx) return;
    this.burst(this.master, 0.2, 0.45, 'lowpass', 900, 200, 0.7);
    this.tone(this.crunch(this.master, 0.3), 'sawtooth', 110, 65, 0.18, 0.5);
  }

  /** Мы попали: короткий щелчок (как хитмаркер). */
  hit(): void {
    if (!this.ctx) return;
    this.tone(this.master, 'square', 1900, 1600, 0.04, 0.12);
  }

  /**
   * Наш фраг: «чаг» из хардкор-брейкдауна — два коротких глухих удара перегруженного пауэр-аккорда
   * (низкая ми + квинта), как палм-мьют на гитаре. Негромко, чтобы не перекрывал бой.
   */
  frag(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Гитара: перегруз, потом срезаем верха — получается «мясной» глухой звук, а не визг
    const cab = ctx.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 900;
    cab.connect(this.master);
    const amp = this.crunch(cab, 0.22);
    for (const delay of [0, 0.14]) {
      this.tone(amp, 'sawtooth', 82, 80, 0.11, 0.6, delay); //  E2
      this.tone(amp, 'sawtooth', 123, 120, 0.11, 0.45, delay); // B2 — квинта
    }
    this.tone(this.master, 'sine', 60, 40, 0.3, 0.25); // «бочка» под чагом
  }

  /** Хэдшот: звонкий «динь» пробитого шлема (как в CS) — неровные металлические обертоны + щелчок. */
  headshot(): void {
    if (!this.ctx) return;
    this.tone(this.master, 'triangle', 3150, 3000, 0.3, 0.2);
    this.tone(this.master, 'sine', 4720, 4600, 0.22, 0.12);
    this.tone(this.master, 'sine', 6900, 6700, 0.12, 0.06);
    this.burst(this.master, 0.03, 0.25, 'highpass', 5000, 4000, 0.7);
  }

  /** Ошмётки: мокрый шлепок там, где кого-то разорвало. */
  splat(pos: Vec3): void {
    const dest = this.out(pos);
    if (dest) this.burst(dest, 0.25, 0.5, 'lowpass', 1200, 250, 1);
  }

  /** Нас убили: низкий рваный спад. */
  death(): void {
    if (!this.ctx) return;
    this.tone(this.crunch(this.master, 0.4), 'sawtooth', 220, 45, 0.8, 0.5);
    this.burst(this.master, 0.6, 0.3, 'lowpass', 1500, 100, 0.7);
  }

  /** Появились на карте: восходящий тон. */
  spawn(): void {
    if (this.ctx) this.tone(this.master, 'sine', 300, 900, 0.3, 0.2);
  }

  // ─── Движение (своё) ──────────────────────────────────────

  jump(): void {
    if (this.ctx) this.burst(this.master, 0.08, 0.12, 'bandpass', 900, 600, 1);
  }

  /** Удачный хоп: звонкий «блип». Чем выше скорость, тем выше тон — на слух понятно, что разгоняешься. */
  hop(speed: number): void {
    if (!this.ctx) return;
    const f = Math.min(Math.max(500 * (speed / 320), 450), 1500);
    this.tone(this.master, 'triangle', f, f * 1.5, 0.09, 0.22);
  }

  /** Приземление: глухой удар, громче — чем быстрее падали (fall — скорость падения, u/s). */
  land(fall: number): void {
    if (!this.ctx) return;
    const vol = Math.min((fall - 250) / 600, 1) * 0.45;
    if (vol <= 0) return;
    this.burst(this.master, 0.12, vol, 'lowpass', 500, 150, 1);
    this.tone(this.master, 'sine', 80, 50, 0.1, vol * 0.6);
  }

  /** Отскок от стены: вовремя — звон из двух нот, не вовремя — глухой толчок. */
  wallJump(timed: boolean): void {
    if (!this.ctx) return;
    if (timed) {
      this.tone(this.master, 'triangle', 880, 1320, 0.12, 0.22);
      this.tone(this.master, 'triangle', 1320, 1760, 0.14, 0.18, 0.05);
    } else {
      this.burst(this.master, 0.12, 0.3, 'bandpass', 700, 400, 1.5);
      this.tone(this.master, 'sine', 160, 90, 0.1, 0.3);
    }
  }

  /** Подкат: скрежет по полу. */
  slide(): void {
    if (this.ctx) this.burst(this.master, 0.45, 0.2, 'bandpass', 2200, 900, 0.8);
  }

  /** Прыжок с пада: «бойнг». */
  pad(): void {
    if (this.ctx) this.tone(this.master, 'sine', 160, 640, 0.35, 0.4);
  }

  // ─── Кирпичики ────────────────────────────────────────────

  /** Куда подключать звук: в мире (с направлением и затуханием) или прямо в уши. null — звук ещё не включён. */
  private out(pos: Vec3 | null): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (!pos) return this.master;
    // equalpower — простое лево/право без тяжёлой «объёмной» обработки
    const p = new PannerNode(ctx, {
      panningModel: 'equalpower', distanceModel: 'inverse',
      refDistance: NEAR, maxDistance: FAR, rolloffFactor: 0.9,
      positionX: pos.x, positionY: pos.y, positionZ: pos.z,
    });
    p.connect(this.master);
    return p;
  }

  /** Перегруз перед dest; gain — громкость после него (перегруз сам по себе громкий). */
  private crunch(dest: AudioNode, gain: number): AudioNode {
    const ctx = this.ctx!;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.crunchCurve;
    const g = ctx.createGain();
    g.gain.value = gain;
    shaper.connect(g).connect(dest);
    return shaper;
  }

  /** Тон: генератор, частота плавно едет f0 → f1 за dur секунд, громкость vol быстро вверх и плавно вниз. */
  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.envelope(g.gain, t, 0.005, vol, dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Шум через фильтр, частота фильтра едет f0 → f1: из этого — взрывы, шипение, удары, скрежет. */
  private burst(
    dest: AudioNode, dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q: number, delay = 0,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.envelope(g.gain, t, 0.004, vol, dur);
    src.connect(filter).connect(g).connect(dest);
    // С разного места буфера — чтобы одинаковые звуки подряд не звучали одинаково
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Громкость: 0 → peak за attack, потом плавно к тишине за decay. */
  private envelope(param: AudioParam, t: number, attack: number, peak: number, decay: number): void {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
}
