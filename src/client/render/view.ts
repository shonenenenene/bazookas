import { ColorManagement, LinearSRGBColorSpace, PerspectiveCamera, WebGLRenderer } from 'three';
import { CLIENT } from '../config';

// Без управления цветом: hex в коде = цвет на экране. Проще и без лишних преобразований.
ColorManagement.enabled = false;

/** Вертикальный FOV для базуки в руках — постоянный, чтобы она не растягивалась при широком обзоре */
const VIEWMODEL_FOV = 55;

/**
 * WebGL-рендер, настроенный на скорость, и камеры: основная (мир) и для базуки в руках.
 * Кадр рисуется в низком разрешении (CLIENT.renderHeight) и растягивается CSS-ом на весь экран.
 */
export function createView(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false, // сглаживание дорогое, а при низком разрешении и не нужно
    stencil: false,
    powerPreference: 'high-performance', // на ноутбуках просим дискретную видеокарту
  });
  renderer.setPixelRatio(1); // не умножаем пиксели на Retina/масштаб Windows
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.autoClear = false; // чистим вручную: сначала мир, потом поверх — базука
  renderer.info.autoReset = false; // счётчик draw calls сбрасываем сами раз в кадр (проходов два)

  const camera = new PerspectiveCamera(75, 1, 4, 4000);
  camera.rotation.order = 'YXZ'; // сначала поворот влево-вправо, потом наклон — как в любом FPS
  const viewmodelCamera = new PerspectiveCamera(VIEWMODEL_FOV, 1, 1, 200);

  /** Для частиц: сколько пикселей занимает 1 юнит на расстоянии 1 */
  const info = { pointScale: 1 };

  canvas.style.imageRendering = CLIENT.crispPixels ? 'pixelated' : 'auto';

  function resize() {
    const aspect = window.innerWidth / window.innerHeight;
    const height = CLIENT.renderHeight > 0 ? Math.min(CLIENT.renderHeight, window.innerHeight) : window.innerHeight;
    // false = не трогать CSS-размер холста: он всегда на весь экран (см. main.css)
    renderer.setSize(Math.round(height * aspect), height, false);

    // FOV задаём по горизонтали (как в Quake), Three.js хочет вертикальный
    const hfov = (CLIENT.fov * Math.PI) / 180;
    const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    camera.fov = (vfov * 180) / Math.PI;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    viewmodelCamera.aspect = aspect;
    viewmodelCamera.updateProjectionMatrix();

    info.pointScale = height / (2 * Math.tan(vfov / 2));
  }
  window.addEventListener('resize', resize);
  resize();

  return { renderer, camera, viewmodelCamera, info };
}
