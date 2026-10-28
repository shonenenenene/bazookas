import { WEAPONS } from '../../shared/weapons';
import type { Input } from '../input';

/**
 * Стартовый экран / пауза. Виден, пока мышь не захвачена.
 * Клик — в игру, Esc (браузер сам отпускает мышь) — обратно в меню.
 * Тексты и вид меню правятся в index.html и main.css; список базук берётся из weapons.ts.
 *
 * Блок сети: ник и комната. Комната — из адреса (?room=имя), без неё игра — одиночная песочница.
 */

export interface MenuOptions {
  /** Комната из адреса; null — песочница */
  room: string | null;
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
/** Буквы для случайного имени комнаты: без похожих друг на друга (l/1, o/0) */
const ROOM_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function setupMenu(input: Input, options: MenuOptions): Menu {
  const menu = byId('menu');
  menu.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.netbox')) return; // поле ника и кнопки сети игру не запускают
    options.onPlay();
    input.lockPointer();
  });
  document.addEventListener('pointerlockchange', () => {
    menu.hidden = input.locked;
  });

  // Арсенал: «1 Ol' Reliable — the classic…»
  const arsenal = byId('menu-arsenal');
  WEAPONS.forEach((w, i) => {
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
    row.append(key, name, motto);
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
    roomEl.append(
      'sandbox (offline) · ',
      button('[ make online room ]', () => {
        location.search = '?room=' + randomRoom();
      }),
    );
  } else {
    const name = document.createElement('b');
    name.textContent = options.room;
    roomEl.append('room ', name, ' · ', button('[ copy link ]', copyLink), ' · ', status);
    status.textContent = 'click 2 join';
  }

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

function button(text: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.addEventListener('click', () => onClick(btn));
  return btn;
}

/** Ссылка на комнату — в буфер обмена (а если браузер не даёт — показываем, чтобы скопировать руками). */
function copyLink(btn: HTMLButtonElement): void {
  const url = location.href;
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
