import { type PerspectiveCamera, Vector3 } from 'three';
import { TICK_DT } from '../../shared/config';
import { type Vec3, addScaled, copy, lerp, set, vec3 } from '../../shared/math';
import type { Rocket } from '../../shared/world';
import { CLIENT } from '../config';
import type { Viewmodel } from './viewmodel';

// Где рисовать ракету. По правилам игры ракета летит из глаз — так она идёт точно в прицел.
// Но свою рисуем со сдвигом к стволу базуки в руках: на экране она вылетает из базуки
// и за CLIENT.muzzleBlendTime плавно (без излома) сливается с настоящей траекторией.

/** На каком расстоянии от глаз в мире «висит» конец ствола (влияет только на картинку) */
const MUZZLE_DEPTH = 40;

export class RocketView {
  /** Ствол минус глаза, в координатах мира — на этот кадр */
  private offset = vec3();
  /** Сдвиг каждой своей ракеты, запомненный при выстреле (дальше камера может крутиться — ракете всё равно) */
  private shots = new WeakMap<Rocket, Vec3>();
  private v = new Vector3();

  /** Раз в кадр, когда камера уже поставлена и базука в руках обновлена. */
  update(camera: PerspectiveCamera, viewmodelCamera: PerspectiveCamera, viewmodel: Viewmodel): void {
    // Ствол → точка экрана (у базуки своя камера), затем → точка мира в этом месте экрана
    viewmodel.muzzle(this.v).project(viewmodelCamera);
    this.v.z = 0.5;
    this.v.unproject(camera).sub(camera.position).normalize().multiplyScalar(MUZZLE_DEPTH);
    set(this.offset, this.v.x, this.v.y, this.v.z);
  }

  /** out = где рисовать ракету: t — доля пути от прошлого тика к текущему, mine — своя ракета. */
  position(out: Vec3, r: Rocket, t: number, mine: boolean): Vec3 {
    lerp(out, r.prevPos, r.pos, t);
    if (!mine) return out;
    const blend = CLIENT.muzzleBlendTime;
    let shot = this.shots.get(r);
    if (!shot) {
      if (r.age > blend) return out; // старая ракета (например, после смены режима) — без сдвига
      shot = copy(vec3(), this.offset); // ракета только что вылетела: запоминаем, где был ствол
      this.shots.set(r, shot);
    }
    const x = (r.age - (1 - t) * TICK_DT) / blend; // 0 — вылет, 1 — слились с траекторией
    if (x >= 1) return out;
    // Сдвиг гаснет по кривой (1 − x)²: сначала быстро, а к концу — плавно, так что излома на траектории нет
    const k = (1 - Math.max(x, 0)) ** 2;
    return addScaled(out, out, shot, k);
  }
}
