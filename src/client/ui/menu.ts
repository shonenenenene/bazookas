import { COMBAT } from '../../shared/config';
import { DEFAULT_MAP } from '../../shared/maps/registry';
import { type WeaponDef, WEAPONS } from '../../shared/weapons';
import type { Input } from '../input';

/**
 * Стартовый экран / пауза. Виден, пока мышь не захвачена.
 * В игру — кнопка PLAY (или клик мимо окна), Esc (браузер сам отпускает мышь) — обратно в меню.
 * Тексты и вид меню правятся в index.html и main.css; список базук — из weapons.ts.
 *
 * Сверху — ник и комната (из адреса ?room=имя; без неё игра — одиночная песочница). Ниже — вкладки:
 * карты (карточки с картинкой из assets/previews/<карта>.jpg — их снимает npm run previews), арсенал, управление.
 * Карта — из адреса (?map=имя): выбрал карточку — страница перезагрузится на ней. В сети карту не выбрать: она у комнаты одна.
 */

// Картинки-превью карт: assets/previews/<имя карты>.jpg (нет файла — карточка без картинки)
const PREVIEWS = import.meta.glob('../../../assets/previews/*.{jpg,jpeg,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
function previewUrl(map: string): string | undefined {
  return Object.entries(PREVIEWS).find(([path]) => path.slice(path.lastIndexOf('/') + 1).startsWith(map + '.'))?.[1];
}

export interface MenuOptions {
  /** Комната из адреса; null — песочница */
  room: string | null;
  /** Текущая карта */
  map: string;
  /** Все карты (assets/maps/*.map + тестовая арена) с описаниями */
  maps: { name: string; description: string }[];
  /** Нажали «играть» (в сети в первый раз здесь подключаемся) */
  onPlay: () => void;
}

export interface Menu {
  /** Ник из поля ввода */
  nickname(): string;
  /** Ник больше не меняется (уже подключились под ним) */
  lockNickname(): void;
  /** Строка состояния сети: «connecting...», «online · 3 players» */
  setStatus(text: string): void;
}

const NICK_KEY = 'bazookas.nick';
const TAB_KEY = 'bazookas.tab';
/** Буквы для случайного имени комнаты: без похожих друг на друга (l/1, o/0) */
const ROOM_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function setupMenu(input: Input, options: MenuOptions): Menu {
  const menu = byId('menu');
  // В игру — кнопкой PLAY или кликом мимо окна (внутри окна — вкладки, карточки, ник)
  const play = () => {
    options.onPlay();
    input.lockPointer();
  };
  menu.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target === menu || target.closest('.play')) play();
  });
  document.addEventListener('pointerlockchange', () => {
    menu.hidden = input.locked;
  });

  // Арсенал: «1 Ol' — the classic…»
  const arsenal = byId('menu-arsenal');
  WEAPONS.forEach((w, i) => {
    if (w.hidden) return; // осколки — не базуки
    const row = document.createElement('li');
    const key = document.createElement('span');
    key.className = 'arsenal__key';
    key.textContent = String(i + 1);
    const name = document.createElement('span');
    name.className = 'arsenal__name';
    name.style.color = '#' + w.color.toString(16).padStart(6, '0');
    name.textContent = w.name;
    const motto = document.createElement('span');
    motto.className = 'arsenal__motto';
    motto.textContent = w.motto;
    const stats = document.createElement('span');
    stats.className = 'arsenal__stats';
    stats.textContent = weaponStats(w);
    row.append(key, name, motto, stats);
    arsenal.append(row);
  });

  // Ник запоминаем в браузере до следующего раза
  const nick = byId('menu-nick') as HTMLInputElement;
  nick.value = load(NICK_KEY);
  nick.addEventListener('change', () => save(NICK_KEY, nick.value.trim()));

  // Комната: в песочнице — кнопка «создать», в сети — имя, ссылка и статус
  const roomEl = byId('menu-room');
  const status = document.createElement('span');
  status.className = 'netbox__status';
  if (options.room === null) {
    roomEl.append('sandbox (offline) · 2 play w/ ppl — tab ', strong('online'));
  } else {
    const name = document.createElement('b');
    name.textContent = options.room;
    roomEl.append('room ', name, ' · ', button('[ copy link ]', copyLink), ' · ', status);
    status.textContent = 'click 2 join';
  }

  // Вкладки: показываем одну панель; выбранную помним до следующего раза
  const tabs = [...menu.querySelectorAll<HTMLButtonElement>('.tab')];
  const panels = [...menu.querySelectorAll<HTMLElement>('.tabpanel')];
  const showTab = (name: string) => {
    for (const t of tabs) t.classList.toggle('tab--active', t.dataset.tab === name);
    for (const p of panels) p.hidden = p.dataset.panel !== name;
    save(TAB_KEY, name);
  };
  for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.tab!));
  showTab(tabs.some((t) => t.dataset.tab === load(TAB_KEY)) ? load(TAB_KEY) : 'online');

  setupLobby(menu, options);

  // Карты: карточка — картинка, имя, описание. Текущая подсвечена. В песочнице клик — перезагрузка на этой карте
  const mapsEl = byId('menu-maps');
  for (const m of options.maps) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'mapcard' + (m.name === options.map ? ' mapcard--current' : '');
    card.disabled = options.room !== null && m.name !== options.map;
    const url = previewUrl(m.name);
    const pic = document.createElement(url ? 'img' : 'div');
    pic.className = 'mapcard__pic';
    if (pic instanceof HTMLImageElement) {
      pic.src = url!;
      pic.alt = '';
      pic.loading = 'lazy';
    } else pic.textContent = 'no preview :(';
    const name = document.createElement('div');
    name.className = 'mapcard__name';
    name.textContent = m.name + (m.name === options.map ? '  ◄ u r here' : '');
    const desc = document.createElement('div');
    desc.className = 'mapcard__desc';
    desc.textContent = m.description;
    card.append(pic, name, desc);
    if (options.room === null && m.name !== options.map) card.addEventListener('click', () => (location.search = '?map=' + m.name));
    mapsEl.append(card);
  }
  byId('menu-maps-note').textContent = options.room === null
    ? 'click a map 2 load it. new maps: assets/maps (TrenchBroom), pics: npm run previews'
    : 'the room picked its map. wanna another? make a new room from the sandbox';

  return {
    nickname: () => nick.value.trim(),
    lockNickname: () => {
      nick.disabled = true;
    },
    setStatus: (text) => {
      status.textContent = text;
    },
  };
}

/** Цифры базуки одной строкой: «hit 100 (head 150) · boom 90 r130 · reload 0.8s · 1600 u/s» (+ осколки) */
function weaponStats(w: WeaponDef): string {
  const head = w.headDamage ?? Math.round(w.directDamage * COMBAT.headshotScale);
  const parts = [`hit ${w.directDamage}${w.rockets > 1 ? '×' + w.rockets : ''} (head ${head})`];
  if (w.splashDamage > 0) parts.push(`boom ${w.splashDamage} r${w.splashRadius}${w.splashFalloff === 0 ? ' full' : ''}`);
  if (w.children) {
    const kid = WEAPONS.find((k) => k.name === w.children!.name);
    if (kid) parts.push(`+${w.children.count} ${kid.name}s × ${kid.directDamage}${kid.splashDamage ? '/' + kid.splashDamage : ''}`);
  }
  if (w.bounces) parts.push(`${w.bounces} bounces`);
  if (w.remote) parts.push('click again = detonate');
  parts.push(`reload ${w.reload}s`, `${w.speed} u/s`);
  return parts.join(' · ');
}

// ─── Лобби (вкладка online) ───────────────────────────────────

/** Комната из /api/rooms (server/room.ts — RoomInfo) */
interface LobbyRoom {
  name: string;
  map: string;
  players: number;
  max: number;
  phase: 'playing' | 'intermission';
  timeLeft: number;
  leader: string;
  leaderFrags: number;
}

/** Перейти в комнату: страница перезагрузится в ней и сразу подключится (&auto=1). */
function goToRoom(name: string, map: string, isPublic = false): void {
  location.search = `?room=${encodeURIComponent(name)}&map=${map}${isPublic ? '&public=1' : ''}&auto=1`;
}

/**
 * Вкладка online: «быстрая игра» (в самую полную открытую комнату, где есть место, — или новую открытую на основной
 * карте), «создать комнату» (на выбранной во вкладке maps карте; открытую — видно всем, или только по ссылке),
 * и список открытых комнат с сервера — обновляется раз в 3 с, пока вкладка на экране.
 */
function setupLobby(menu: HTMLElement, options: MenuOptions): void {
  const actions = byId('menu-lobby-actions');
  const list = byId('menu-lobby-rooms');
  const status = byId('menu-lobby-status');
  const panel = menu.querySelector<HTMLElement>('[data-panel="online"]')!;
  let rooms: LobbyRoom[] = [];

  if (options.room === null) {
    const priv = document.createElement('input');
    priv.type = 'checkbox';
    const privLabel = document.createElement('label');
    privLabel.className = 'lobby__private';
    privLabel.append(priv, ' private (link only)');
    actions.append(
      button('[ QUICK PLAY ]', () => {
        const free = rooms.find((r) => r.players < r.max && r.phase === 'playing');
        if (free) goToRoom(free.name, free.map);
        else goToRoom('pub-' + randomRoom(), DEFAULT_MAP, true);
      }),
      button(`[ create room on ${options.map} ]`, () => goToRoom(randomRoom(), options.map, !priv.checked)),
      privLabel,
    );
  } else {
    actions.append(`u r in room `, strong(options.room), ' · ', button('[ leave 2 sandbox ]', () => (location.search = '')));
  }

  const render = () => {
    list.replaceChildren(
      ...rooms.map((r) => {
        const tr = document.createElement('tr');
        const match = r.phase === 'intermission' ? 'results...' : `${clock(r.timeLeft)}${r.leader ? ` · ${r.leader} ${r.leaderFrags}` : ''}`;
        for (const text of [r.name, r.map, `${r.players}/${r.max}`, match]) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.append(td);
        }
        const td = document.createElement('td');
        const here = r.name === options.room;
        const join = button(here ? '[ u r here ]' : r.players >= r.max ? '[ full ]' : '[ join ]', () => goToRoom(r.name, r.map));
        join.disabled = here || r.players >= r.max;
        td.append(join);
        tr.append(td);
        return tr;
      }),
    );
    status.textContent = rooms.length ? '' : 'no open rooms rn. hit QUICK PLAY — ppl will find u';
  };

  const refresh = async () => {
    if (menu.hidden || panel.hidden) return; // не на экране — не дёргаем сервер
    try {
      const res = await fetch('/api/rooms', { cache: 'no-store' });
      rooms = ((await res.json()) as { rooms: LobbyRoom[] }).rooms;
      render();
    } catch {
      rooms = [];
      list.replaceChildren();
      status.textContent = 'server offline :( (local: npm run server)';
    }
  };
  void refresh();
  setInterval(refresh, 3000);
  for (const t of menu.querySelectorAll('.tab')) t.addEventListener('click', () => void refresh());
}

function strong(text: string): HTMLElement {
  const b = document.createElement('b');
  b.textContent = text;
  return b;
}

/** Секунды → «8:05» */
function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function button(text: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.addEventListener('click', () => onClick(btn));
  return btn;
}

/** Ссылка на комнату — в буфер обмена (а если браузер не даёт — показываем, чтобы скопировать руками). */
function copyLink(btn: HTMLButtonElement): void {
  // Чистая ссылка — только комната: карту друг узнает от сервера, ник введёт свой
  const room = new URLSearchParams(location.search).get('room') ?? '';
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  const done = () => {
    btn.textContent = '[ copied! ]';
    setTimeout(() => (btn.textContent = '[ copy link ]'), 1500);
  };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('copy this link:', url));
  else prompt('copy this link:', url); // буфер обмена работает только на https и localhost
}

function randomRoom(): string {
  let id = '';
  for (let i = 0; i < 6; i++) id += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  return id;
}

// localStorage может быть запрещён (приватный режим, настройки браузера) — тогда просто не запоминаем
function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // не страшно
  }
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`В index.html нет элемента #${id}`);
  return el;
}
