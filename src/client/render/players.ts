import { Color, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { boxBrush } from '../../shared/collision/brush';
import { lerp, vec3 } from '../../shared/math';
import type { World } from '../../shared/world';
import { buildBrushGeometry } from './mapMesh';

// Все игроки и манекены рисуются одним InstancedMesh: одна модель, много копий = один draw call.
// Модель серая, цвет каждой копии задаётся отдельно (тинт), а при попадании она вспыхивает белым.

/** Цвета игроков по id */
const TINTS = [0xff1aa8, 0x39ff14, 0xffe14a, 0x00e5ff, 0xff7a1a, 0xb388ff];
/** Сколько секунд длится белая вспышка при попадании */
const FLASH_TIME = 0.12;

export class PlayerMeshes {
  readonly mesh: InstancedMesh;
  private flashUntil = new Map<number, number>(); // id игрока → время конца вспышки
  private time = 0;
  // Черновики
  private matrix = new Matrix4();
  private color = new Color();
  private pos = vec3();

  constructor(maxPlayers = 32) {
    // Человечек из коробок. Центр коробки игрока — (0,0,0), смотрит в −Z
    const geometry = buildBrushGeometry([
      boxBrush(vec3(-14, -28, -14), vec3(14, 8, 14), 0xbbbbbb), //   тело
      boxBrush(vec3(-10, 8, -10), vec3(10, 28, 10), 0xffffff), //    голова
      boxBrush(vec3(-8, 15, -11), vec3(8, 20, -10), 0x181818), //    визор
      boxBrush(vec3(14, 2, -26), vec3(20, 9, 12), 0x555555), //      базука на плече
    ]);
    this.mesh = new InstancedMesh(geometry, new MeshBasicMaterial({ vertexColors: true }), maxPlayers);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    // Цвета заводим сразу, иначе шейдер соберётся без их поддержки
    for (let i = 0; i < maxPlayers; i++) this.mesh.setColorAt(i, this.color.setHex(0xffffff));
    this.mesh.count = 0;
  }

  /** Вспышка при попадании. */
  flash(playerId: number): void {
    this.flashUntil.set(playerId, this.time + FLASH_TIME);
  }

  /** Расставить копии модели по игрокам. skipId — свой игрок (себя от первого лица не рисуем). */
  update(world: World, alpha: number, skipId: number, dt: number): void {
    this.time += dt;
    let n = 0;
    for (const p of world.players) {
      if (p.dead || p.id === skipId || n >= this.mesh.instanceMatrix.count) continue;
      lerp(this.pos, p.prevOrigin, p.state.origin, alpha);
      this.matrix.makeRotationY(p.cmd.yaw);
      this.matrix.setPosition(this.pos.x, this.pos.y, this.pos.z);
      this.mesh.setMatrixAt(n, this.matrix);

      const flashing = (this.flashUntil.get(p.id) ?? 0) > this.time;
      this.mesh.setColorAt(n, this.color.setHex(flashing ? 0xffffff : TINTS[p.id % TINTS.length]));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
