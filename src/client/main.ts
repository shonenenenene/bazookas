// Точка входа клиента: собирает игру из частей и запускает цикл.

import '@fontsource/vt323';
import '@fontsource/unifrakturmaguntia';
import './styles/main.css';

import { Color, Fog, Scene } from 'three';
import { PLAYER, TICK_DT } from '../shared/config';
import { testMap } from '../shared/maps/testMap';
import { lengthXZ, lerp, vec3 } from '../shared/math';
import { WEAPONS } from '../shared/weapons';
import { addPlayer, createWorld, respawnPlayer, worldTick } from '../shared/world';
import { Effects } from './effects';
import { Input } from './input';
import { startLoop } from './loop';
import { buildMapMesh } from './render/mapMesh';
import { Particles } from './render/particles';
import { PlayerMeshes } from './render/players';
import { createTileTexture } from './render/textures';
import { createView } from './render/view';
import { Viewmodel } from './render/viewmodel';
import { Hud } from './ui/hud';
import { setupMenu } from './ui/menu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const map = testMap;

// ─── Мир ───
const world = createWorld(map); // манекены с карты добавляются сами
const me = addPlayer(world, 'you', map.spawns[0]);

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
scene.add(buildMapMesh(map, createTileTexture()), playerMeshes.mesh, particles.object);
scene.updateMatrixWorld();

// ─── Ввод, интерфейс, эффекты ───
const input = new Input(canvas);
const hud = new Hud();
setupMenu(input);
const effects = new Effects(world, me, particles, hud, playerMeshes, viewmodel, input);
effects.handleEvents(); // события появления игроков при старте

// R — вернуться на старт (удобно в песочнице)
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && input.locked) respawnPlayer(world, me);
});

// ─── Цикл ───
const viewPos = vec3();
const rocketPos = vec3();

startLoop(
  // Тик: строго 60 раз в секунду
  () => {
    input.fillCmd(me.cmd);
    worldTick(world, TICK_DT);
    effects.handleEvents();
    effects.emitTrails();
  },
  // Кадр: столько раз, сколько тянет монитор
  (alpha, frameDt) => {
    renderer.info.reset();

    // Камера: плавно между тиками + тряска от взрывов. Мёртвым — заваливаемся набок
    const shake = effects.updateShake(frameDt);
    lerp(viewPos, me.prevOrigin, me.state.origin, alpha);
    camera.position.set(
      viewPos.x + (Math.random() - 0.5) * shake,
      viewPos.y + PLAYER.eyeHeight + (Math.random() - 0.5) * shake - (me.dead ? 30 : 0),
      viewPos.z + (Math.random() - 0.5) * shake,
    );
    camera.rotation.set(input.pitch, input.yaw, me.dead ? 0.5 : 0);
    camera.updateMatrixWorld();

    // Динамика сцены
    playerMeshes.update(world, alpha, me.id, frameDt);
    particles.update(frameDt);
    for (const r of world.rockets) {
      lerp(rocketPos, r.prevPos, r.pos, alpha);
      particles.addPoint(rocketPos, 14, WEAPONS[r.weapon].color); // ореол
      particles.addPoint(rocketPos, 5, 0xffffff); //                 яркое ядро
    }
    particles.commit(info.pointScale);
    viewmodel.update(frameDt, me.weapon, lengthXZ(me.state.velocity), me.state.onGround, me.dead);

    // Рисуем: мир, потом поверх него — базуку в руках
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(viewmodel.scene, viewmodelCamera);

    hud.update(frameDt, lengthXZ(me.state.velocity), renderer.info.render.calls);
    hud.setHealth(me.health);
    hud.setWeapon(me.weapon);
  },
);
