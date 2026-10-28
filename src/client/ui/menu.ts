import { WEAPONS } from '../../shared/weapons';
import type { Input } from '../input';

/**
 * Стартовый экран / пауза. Виден, пока мышь не захвачена.
 * Клик — в игру, Esc (браузер сам отпускает мышь) — обратно в меню.
 * Тексты и вид меню правятся в index.html и main.css; список базук берётся из weapons.ts.
 */
export function setupMenu(input: Input): void {
  const menu = document.getElementById('menu')!;
  menu.addEventListener('click', () => input.lockPointer());
  document.addEventListener('pointerlockchange', () => {
    menu.hidden = input.locked;
  });

  // Арсенал: «1 Ol' Reliable — the classic…»
  const arsenal = document.getElementById('menu-arsenal')!;
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
}
