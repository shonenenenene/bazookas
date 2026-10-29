# The Bazookas

Браузерный онлайн PvP-шутер в духе Quake, где у всех только базуки. Ракеты летят по дуге, рокет-джампы,
банни-хоп, серф, отскоки от стен. Эстетика интернета нулевых, готики, веб-панка и эмо, графика под PS2.

*A browser arena shooter in the spirit of Quake where everyone only has bazookas.*

## Запуск

Нужен Node.js 20.19+.

```
npm install        установить зависимости
npm run dev        игра: http://localhost:5173 (без ?room — одиночная песочница с манекенами)
npm run server     игровой сервер для сетевой игры (порт 8080)
npm test           автопроверки физики, боя и сети
npm run build      сборка в dist/
```

Сетевая игра: запусти `npm run server` и `npm run dev`, в меню — вкладка **online**: QUICK PLAY, своя комната
(открытая — видна в списке, или приватная — только по ссылке) и список открытых комнат.
Для локальной сети вместо `npm run dev` — `npx vite --host`, друзьям — `http://<твой-IP>:5173/?room=…`.

В онлайне — матч «каждый сам за себя»: до 25 фрагов или 10 минут, таблица счёта на **Tab**, потом 10 секунд итогов
и следующая карта (тренировочные, вроде `sky_surf`, в смену карт не попадают). До 10 игроков в комнате.
Настройки — в `src/server/config.ts`.

Управление — в меню игры.

## Деплой (Docker + Nginx Proxy Manager)

Один контейнер раздаёт и саму игру, и WebSocket на порту 8080; HTTPS делает Nginx Proxy Manager.

1. На сервере: `git clone …` и `cd bazooka`.
2. Узнай сеть, в которой стоит NPM: `docker network ls` (обычно `<папка-npm>_default`). Запиши её в файл `.env`
   рядом с `docker-compose.yml`: `PROXY_NETWORK=имя_сети`.
3. `docker compose up -d --build` — соберёт и запустит контейнер `bazookas`.
4. В NPM: **Proxy Hosts → Add**: домен, Scheme `http`, Forward Hostname `bazookas`, Port `8080`,
   включи **Websockets Support** и **Block Common Exploits**; на вкладке SSL — сертификат Let's Encrypt и **Force SSL**.
5. Открой `https://твой-домен` — готово.

Обновить: `git pull && docker compose up -d --build`. Вкладки игроков со старой версией сами перезагрузятся
(сервер сверяет версию протокола — `PROTOCOL_VERSION` в `src/shared/net/protocol.ts`; поменял сетевые сообщения —
увеличь её). Логи: `docker logs -f bazookas`.

## Карты (TrenchBroom)

Карты лежат в `assets/maps/*.map` и правятся в бесплатном редакторе [TrenchBroom](https://trenchbroom.github.io/).
Карта выбирается в меню или адресом: `?map=speedway`, `?map=sky_surf` (серф-кольцо в космосе), `?map=test_arena`.
Без `?map` — `speedway`.

Настройка один раз:

1. Скопируй содержимое папки `trenchbroom/` (GameConfig.cfg, bazookas.fgd, Icon.png)
   в `%APPDATA%\TrenchBroom\games\Bazookas\` (на Linux — `~/.TrenchBroom/games/Bazookas/`).
2. Запусти TrenchBroom → *Preferences* → игра **The Bazookas** → *Game Path* = папка `assets` этого проекта.
3. *New map* → The Bazookas → формат Valve. Сохраняй в `assets/maps/имя.map` —
   открытая в браузере игра (`npm run dev`) перезагрузится сама, сервер подхватит карту в новой комнате.

Что ставить на карту:

- **Блоки** — обычные браши. Цвет блока — по имени текстуры: `floor`, `wall`, `ramp`, `surf`, `crate`, `bone`,
  `blood`, `platform`, `accent`, `pad`, `booster`, `stairs`, `wallrun` (список — `src/shared/maps/materials.ts`).
  Новая текстура: добавь цвет в `materials.ts` и запусти `npm run textures` — появится картинка для редактора.
- `info_player_deathmatch` — точка появления (стрелка — куда смотришь).
- `bazooka_dummy` — манекен-мишень (`bot`: idle / strafe / bhop).
- `trigger_jumppad` — браш-зона джамп-пада (`height` — высота прыжка), `trigger_booster` — ускоритель
  (`angle` — направление, `speed`). Зоны невидимы — положи под них видимую плитку `pad` / `booster`.
- `trigger_void` — пропасть: на карте с чекпоинтами упал — сразу на последнем чекпоинте, иначе гибнешь.
  `trigger_checkpoint` — зона чекпоинта, `target` — имя точки `info_checkpoint`, где появишься (`speed` — сразу с этой
  скоростью вперёд);
  `reset` = 1 — финиш (чекпоинт забывается, дальше со старта).
- В свойствах `worldspawn`: `sky_color`, `fog_near`, `fog_far` (туман = дальность прорисовки), `sky` = `space` — космос
  со звёздами и кровавой луной, `description` — пара строк о карте для меню.
- `info_preview` — откуда снимать картинку карты для меню (`angle` — куда смотреть, `pitch` — вверх/вниз).
  Снять картинки всех карт: `npm run previews` (нужен Google Chrome) — они лягут в `assets/previews/`.

Луны на `sky_surf` могут показывать картинки: положи `moon-face.jpg` (большая, кровавая) и `moon-tv.jpg` (малая,
«ангельская») в `assets/sky/`. Без них луны обычные.

Стартовые карты собираются кодом (`tools/generateMaps.ts`): `npm run maps:generate` создаёт недостающие,
`npm run maps:generate -- --force` перезаписывает (правки из редактора пропадут).

## Лицензии

- **Код** — [GNU AGPL-3.0-or-later](LICENSE). Можно использовать, изменять и распространять. Изменённую версию
  нужно отдавать под той же лицензией вместе с исходниками — в том числе если ты просто запускаешь её
  как онлайн-сервер для других игроков.
- **Игровой контент** (папка `assets/`) — без лицензии: лицензия кода на него не распространяется.
  Часть файлов — чужие (например, картинки в `assets/sky/`); права на них принадлежат их авторам.
- Название **The Bazookas** лицензией не передаётся.
- **Сторонние части** собранной игры: three.js (MIT), шрифты VT323 и UnifrakturMaguntia (SIL OFL 1.1) —
  тексты лицензий в [public/THIRD_PARTY_LICENSES.txt](public/THIRD_PARTY_LICENSES.txt). Сервер использует `ws` (MIT).

Движение и столкновения написаны с нуля, но по алгоритмам Quake 3 (id Software), управление в воздухе — по мотивам
CPMA, прижимание к полу на спусках — как StayOnGround в Source.
