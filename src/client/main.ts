// Точка входа клиента: собирает игру из частей и запускает цикл.
// Два режима: адрес с ?room=имя — сетевая игра в этой комнате, без него — одиночная песочница с манекенами.

import '@fontsource/vt323';
import '@fontsource/unifrakturmaguntia';
import './styles/main.css';

import { Color, Fog, Scene } from 'three';
import { TICK_DT } from '../shared/config';
import { testMap } from '../shared/maps/testMap';
import { addScaled, lengthXZ, lerp, vec3 } from '../shared/math';
import { cleanRoomName } from '../shared/net/protocol';
import { eyeHeight } from '../shared/player';
import { WEAPONS } from '../shared/weapons';
import { type Rocket, addPlayer, createWorld, respawnPlayer, worldTick } from '../shared/world';
import { CLIENT } from './config';
import { Effects } from './effects';
import { Input } from './input';
import { startLoop } from './loop';
import { Connection } from './net/connection';
import { OnlineSession } from './net/online';
import { buildMapMesh } from './render/mapMesh';
import { Particles } from './render/particles';
import { PlayerMeshes } from './render/players';
import { RocketView } from './render/rocketView';
import { StepSmooth } from './render/stepSmooth';
import { createTileTexture } from './render/textures';
import { createView } from './render/view';
import { Viewmodel } from './render/viewmodel';
import { Hud } from './ui/hud';
import { setupMenu } from './ui/menu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const map = testMap;
const params = new URLSearchParams(location.search);
const roomParam = params.get('room');
const room = roomParam === null ? null : cleanRoomName(roomParam);
const online = room !== null;

// ─── Мир ───
// В сети манекенов и правила (попадания, смерти) присылает сервер, а мы только предсказываем себя
const world = createWorld(map, { dummies: !online, authority: !online });
const me = addPlayer(world, 'you', map.spawns[0]);
let session: OnlineSession | null = null;

// ─── Графика ───
const { renderer, camera, viewmodelCamera, info } = createView(canvas);
const scene = new Scene();
scene.background = new Color(map.skyColor);
scene.fog = new Fog(map.skyColor, map.fogNear, map.fogFar);
scene.matrixWorldAutoUpdate = false; // в сцене всё статично, камеру обновляем сами
camera.far = map.fogFar; // дальше тумана всё равно ничего не видно — и не рисуем
camera.updateProjectionMatrix();

const particles = new Particles();
const playerMeshes = new PlayerMeshes();
const viewmodel = new Viewmodel();
const rocketView = new RocketView();
scene.add(buildMapMesh(map, createTileTexture()), playerMeshes.mesh, particles.object);
scene.updateMatrixWorld();

// ─── Ввод, интерфейс, эффекты ───
const input = new Input(canvas);
const hud = new Hud();
const menu = setupMenu(input, { room, onPlay: connect });
const effects = new Effects(world, me, particles, hud, playerMeshes, viewmodel, input, rocketView);
effects.handleEvents(); // события появления игроков при старте

// R — вернуться на старт (только в песочнице: в сети это было бы читерством)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && input.locked && !online) respawnPlayer(world, me);
});

/** Подключиться к комнате (при первом нажатии «играть», когда ник уже введён). */
function connect(): void {
  if (!room || session) return;
  me.name = menu.nickname();
  menu.lockNickname();
  const base = CLIENT.serverUrl || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const url = `${base}?room=${encodeURIComponent(room)}&name=${encodeURIComponent(me.name)}`;
  const lag = Number(params.get('lag') ?? CLIENT.fakeLag) || 0;

  const connection = new Connection(url, lag);
  const s = new OnlineSession(world, me, connection);
  session = s;
  const showRoster = () => menu.setStatus(`online · ${s.humans} in room${lag ? ` · fake lag ${lag}ms` : ''}`);
  s.onRoster = showRoster;
  menu.setStatus('connecting...');
  connection.onStatus = (status) => {
    if (status === 'open') showRoster();
    if (status === 'closed') {
      const wasOnline = s.ready;
      menu.setStatus(connection.closeReason || (wasOnline ? 'disconnected. refresh (F5)' : 'server offline :( run npm run server'));
      document.exitPointerLock(); // показать меню с причиной
    }
  };
}

// ─── Цикл ───
const viewPos = vec3();
const rocketPos = vec3();
const stepSmooth = new StepSmooth();
/** Высота глаз над центром коробки — плавно меняется, когда приседаем */
let eye = eyeHeight(me.state);

/** Голова ракеты: ореол + яркое ядро. Свою рисуем из ствола базуки (см. rocketView.ts) */
function drawRocket(r: Rocket, alpha: number): void {
  rocketView.position(rocketPos, r, alpha, r.ownerId === me.id);
  particles.addPoint(rocketPos, 14, WEAPONS[r.weapon].color);
  particles.addPoint(rocketPos, 5, 0xffffff);
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
    camera.updateMatrixWorld();

    // Динамика сцены
    viewmodel.update(frameDt, me.weapon, lengthXZ(me.state.velocity), me.state.onGround, me.dead);
    rocketView.update(camera, viewmodelCamera, viewmodel);
    playerMeshes.update(world, alpha, me.id, frameDt);
    particles.update(frameDt);
    for (const r of world.rockets) drawRocket(r, alpha);
    for (const r of world.predictedRockets) drawRocket(r, alpha);
    particles.commit(info.pointScale);

    // Рисуем: мир, потом поверх него — базуку в руках
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(viewmodel.scene, viewmodelCamera);

    hud.update(frameDt, lengthXZ(me.state.velocity), renderer.info.render.calls, session ? session.ping : null);
    hud.setHealth(me.health);
    hud.setWeapon(me.weapon);
  },
);