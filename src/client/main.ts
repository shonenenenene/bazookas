// Точка входа клиента: собирает игру из частей и запускает цикл.
// Два режима: адрес с ?room=имя — сетевая игра в этой комнате, без него — одиночная песочница с манекенами.

import '@fontsource/vt323';
import '@fontsource/unifrakturmaguntia';
import './styles/main.css';

import { Color, Fog, Scene } from 'three';
import { TICK_DT } from '../shared/config';
import { DEFAULT_MAP, cleanMapName, loadMap, mapList } from '../shared/maps/registry';
import { addScaled, lengthXZ, lerp, set, vec3 } from '../shared/math';
import { CLOSE, PROTOCOL_VERSION, cleanRoomName } from '../shared/net/protocol';
import { eyeHeight } from '../shared/player';
import { WEAPONS } from '../shared/weapons';
import { type Rocket, addPlayer, createWorld, respawnPlayer, worldTick } from '../shared/world';
import { CLIENT } from './config';
import { MovementSounds } from './audio/movementSounds';
import { Sound } from './audio/sound';
import { Effects, drawKnife } from './effects';
import { Input } from './input';
import { startLoop } from './loop';
import { Connection } from './net/connection';
import { MAP_FILES } from './maps';
import { OnlineSession } from './net/online';
import { buildMapMesh } from './render/mapMesh';
import { Particles } from './render/particles';
import { PlayerMeshes } from './render/players';
import { RocketView } from './render/rocketView';
import { ZenithMoon, createSpaceSky } from './render/sky';
import { StepSmooth } from './render/stepSmooth';
import { createTileTexture } from './render/textures';
import { createView } from './render/view';
import { Viewmodel } from './render/viewmodel';
import { Hud } from './ui/hud';
import { setupMenu } from './ui/menu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const map = loadMap(cleanMapName(params.get('map') ?? DEFAULT_MAP), MAP_FILES);
const roomParam = params.get('room');
const room = roomParam === null ? null : cleanRoomName(roomParam);
const online = room !== null;
// Режим съёмки превью для меню (?preview=1, его открывает npm run previews): камера стоит в map.preview,
// без меню, HUD и базуки в руках
const previewMode = params.has('preview');
if (previewMode) document.body.classList.add('preview');

// ─── Мир ───
// В сети манекенов и правила (попадания, смерти) присылает сервер, а мы только предсказываем себя
const world = createWorld(map, { dummies: !online, authority: !online });
const me = addPlayer(world, 'you', map.spawns[0]);
let session: OnlineSession | null = null;

// ─── Графика ───
const { renderer, camera, viewmodelCamera, info } = createView(canvas);
const scene = new Scene();
// Небо: просто цвет или космос (картинка куба — ещё один draw call, только на таких картах)
scene.background = map.sky === 'space' ? createSpaceSky(map.skyColor) : new Color(map.skyColor);
scene.fog = new Fog(map.skyColor, map.fogNear, map.fogFar);
scene.matrixWorldAutoUpdate = false; // в сцене всё статично, камеру обновляем сами
camera.far = map.fogFar; // дальше тумана всё равно ничего не видно — и не рисуем
camera.updateProjectionMatrix();

const particles = new Particles();
const playerMeshes = new PlayerMeshes();
const viewmodel = new Viewmodel();
const rocketView = new RocketView();
scene.add(buildMapMesh(map, createTileTexture()), playerMeshes.mesh, particles.object);
// Малая луна в зените — только в космосе (поворачивается за взглядом, поэтому не часть картинки неба)
const zenithMoon = map.sky === 'space' ? new ZenithMoon() : null;
if (zenithMoon) scene.add(zenithMoon.mesh);
scene.updateMatrixWorld();

// ─── Ввод, интерфейс, эффекты ───
const input = new Input(canvas);
const hud = new Hud();
const sound = new Sound();
const movementSounds = new MovementSounds(sound);
// «Играть»: включаем звук (браузер разрешает только после клика) и в сети — подключаемся
const menu = setupMenu(input, {
  room,
  map: map.name,
  maps: mapList(MAP_FILES),
  onPlay: () => {
    sound.resume();
    connect();
  },
});
const effects = new Effects(world, me, particles, hud, playerMeshes, viewmodel, input, rocketView, sound);
effects.handleEvents(); // события появления игроков при старте

// R — вернуться на старт (только в песочнице: в сети это было бы читерством)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && input.locked && !online) respawnPlayer(world, me);
});

/** Перейти в ту же комнату заново (после смены карты или обрыва): сразу подключиться, не дожидаясь «играть». */
function rejoin(mapName: string): void {
  params.set('map', mapName);
  params.set('auto', '1');
  location.search = '?' + params.toString();
}

/**
 * Подключиться к комнате. Сразу при открытии, если ник уже есть (запомнен) или пришли по rejoin (&auto=1),
 * иначе — при первом нажатии «играть», когда ник введён.
 */
function connect(): void {
  if (!room || session) return;
  me.name = menu.nickname();
  menu.lockNickname();
  const base = CLIENT.serverUrl || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  // public=1 — комнату видно в лобби (важно, только когда мы её создаём; дальше сервер помнит сам)
  const url = `${base}?room=${encodeURIComponent(room)}&name=${encodeURIComponent(me.name)}&map=${map.name}` +
    `&v=${PROTOCOL_VERSION}${params.get('public') === '1' ? '&public=1' : ''}`;
  const lag = Number(params.get('lag') ?? CLIENT.fakeLag) || 0;

  const connection = new Connection(url, lag);
  // Ушли со страницы (в другую комнату, закрыли вкладку) — закрываем сразу, не ждём «пульса» сервера
  window.addEventListener('pagehide', () => connection.close());
  const s = new OnlineSession(world, me, connection);
  session = s;
  const showRoster = () => menu.setStatus(`online · ${s.humans} in room${lag ? ` · fake lag ${lag}ms` : ''}`);
  s.onRoster = showRoster;
  // Комната на другой карте (создана так или сменила её после матча) — перезагружаемся на неё, в ту же комнату
  s.onWrongMap = (name) => rejoin(name);
  menu.setStatus('connecting...');
  connection.onStatus = (status) => {
    if (status === 'open') showRoster();
    if (status !== 'closed') return;
    // Сервер обновился, а вкладка старая — перезагрузимся, получим новую версию
    if (connection.closeCode === CLOSE.VERSION) {
      location.reload();
      return;
    }
    document.exitPointerLock(); // показать меню с причиной
    // Связь оборвалась посреди игры (не «комната полна» и т.п.) — через 3 с пробуем вернуться
    if (s.ready && connection.closeCode !== CLOSE.FULL && connection.closeCode !== CLOSE.LIMIT) {
      menu.setStatus('connection lost. reconnecting in 3s...');
      setTimeout(() => rejoin(map.name), 3000);
      return;
    }
    menu.setStatus(connection.closeReason || (s.ready ? 'disconnected. refresh (F5)' : 'server offline :( try later'));
  };
}
// Ник уже есть (или вернулись после смены карты) — подключаемся сразу, не дожидаясь «играть»
if (room && !previewMode && (params.has('auto') || menu.nickname())) connect();

// ─── Цикл ───
const viewPos = vec3();
const rocketPos = vec3();
const stepSmooth = new StepSmooth();
/** Высота глаз над центром коробки — плавно меняется, когда приседаем */
let eye = eyeHeight(me.state);

/** Манекен ли это (в таблицу счёта не попадают) — функция одна на всё время, не создаётся каждый кадр */
const isBot = (id: number) => session?.isBot(id) ?? false;

const knifeDir = vec3();
const knifeTmp = vec3();

/** Голова ракеты: ореол + яркое ядро. Свою рисуем из ствола базуки (см. rocketView.ts) */
function drawRocket(r: Rocket, alpha: number): void {
  const w = WEAPONS[r.weapon];
  rocketView.position(rocketPos, r, alpha, r.ownerId === me.id && !w.hidden); // осколки летят не из ствола
  if (w.look === 'knife') {
    // Нож — лезвие по направлению полёта
    const len = Math.hypot(r.vel.x, r.vel.y, r.vel.z) || 1;
    set(knifeDir, r.vel.x / len, r.vel.y / len, r.vel.z / len);
    drawKnife(particles, rocketPos, knifeDir, 1, knifeTmp);
    return;
  }
  const size = w.size ?? 1;
  particles.addPoint(rocketPos, 14 * size, w.color);
  particles.addPoint(rocketPos, 5 * size, 0xffffff);
}

startLoop(
  // Тик: строго 60 раз в секунду
  () => {
    if (session) session.tick(input);
    else if (!online) {
      input.fillCmd(me.cmd);
      worldTick(world, TICK_DT);
    }
    stepSmooth.onTick(me.lastStep);
    movementSounds.update(me.state, me.dead);
    hud.wallJumps(me.state);
    effects.handleEvents();
    effects.emitTrails();
    effects.emitTriggerSparks();
  },
  // Кадр: столько раз, сколько тянет монитор
  (alpha, frameDt) => {
    renderer.info.reset();

    // Камера: плавно между тиками, без рывков на ступеньках, приседе и от поправок сервера + тряска от взрывов.
    // Мёртвым — заваливаемся набок
    const shake = effects.updateShake(frameDt);
    lerp(viewPos, me.prevOrigin, me.state.origin, alpha);
    if (session) addScaled(viewPos, viewPos, session.predictor.smooth(frameDt), 1);
    eye += (eyeHeight(me.state) - eye) * (1 - Math.exp(-frameDt * 18));
    camera.position.set(
      viewPos.x + (Math.random() - 0.5) * shake,
      viewPos.y + stepSmooth.offset(alpha) + eye + (Math.random() - 0.5) * shake - (me.dead ? 30 : 0),
      viewPos.z + (Math.random() - 0.5) * shake,
    );
    camera.rotation.set(input.pitch, input.yaw, me.dead ? 0.5 : 0);
    if (previewMode) {
      const shot = map.preview ?? { eye: vec3(map.spawns[0].feet.x, map.spawns[0].feet.y + 46, map.spawns[0].feet.z), yaw: map.spawns[0].yaw, pitch: 0 };
      camera.position.set(shot.eye.x, shot.eye.y, shot.eye.z);
      camera.rotation.set(shot.pitch, shot.yaw, 0);
    }
    camera.updateMatrixWorld();
    zenithMoon?.update(camera.position, previewMode ? camera.rotation.y : input.yaw);
    // Уши — там же, где камера («вперёд» = (−sin yaw · cos pitch, sin pitch, −cos yaw · cos pitch))
    const cosP = Math.cos(input.pitch);
    sound.listen(camera.position, -Math.sin(input.yaw) * cosP, Math.sin(input.pitch), -Math.cos(input.yaw) * cosP);

    // Динамика сцены
    viewmodel.update(frameDt, me.weapon, lengthXZ(me.state.velocity), me.state.onGround, me.dead);
    rocketView.update(camera, viewmodelCamera, viewmodel);
    playerMeshes.update(world, alpha, me.id, frameDt);
    particles.update(frameDt);
    effects.drawKnives(frameDt);
    for (const r of world.rockets) drawRocket(r, alpha);
    for (const r of world.predictedRockets) drawRocket(r, alpha);
    particles.commit(info.pointScale);

    // Рисуем: мир, потом поверх него — базуку в руках
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    if (!previewMode) renderer.render(viewmodel.scene, viewmodelCamera);

    hud.update(frameDt, lengthXZ(me.state.velocity), renderer.info.render.calls, session ? session.ping : null);
    hud.setHealth(me.health);
    hud.setWeapon(me.weapon);
    hud.setSpread(me.bloom);
    // Матч и таблица счёта (в сети): таблица — пока держишь Tab и в паузе с итогами
    if (session) hud.match(session.match, world.players, isBot, me.id, input.held('Tab'));
  },
);