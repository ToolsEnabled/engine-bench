// The off-screen renderer. Agent views, goal views, score masks and export frames all come
// from here, so every agent is shown its model with the same cameras, light and colours.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TRUTH } from './specs';

export type View = 'iso' | 'timing_end' | 'flywheel_end' | 'intake_side' | 'exhaust_side' | 'top' | 'bottom';
export const VIEW_DIRS: Record<View, [number, number, number]> = {
  iso: [1, -1.15, .8], timing_end: [1, 0, 0], flywheel_end: [-1, 0, 0], intake_side: [0, 1, 0],
  exhaust_side: [0, -1, 0], top: [0, 0, 1], bottom: [0, 0, -1],
};
export const REF_BOX = new THREE.Box3(new THREE.Vector3(...TRUTH.bounds[0]), new THREE.Vector3(...TRUTH.bounds[1]));

const MASK = 256;
// The six sides the score looks from. The first three also give the silhouettes.
export const SCORE_VIEWS: View[] = ['timing_end', 'exhaust_side', 'top', 'flywheel_end', 'intake_side', 'bottom'];

// Fits an orthographic camera to a box seen from a direction, Z up (Y up for top and bottom).
export function frameOrtho(cam: THREE.OrthographicCamera, box: THREE.Box3, dir: THREE.Vector3, aspect: number, margin = 1.08) {
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const up = Math.abs(dir.z) > .99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  cam.up.copy(up);
  cam.position.copy(c).addScaledVector(dir, r * 4);
  cam.lookAt(c);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  let w = 0, h = 0;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
    const q = c.clone().applyMatrix4(inv);
    w = Math.max(w, Math.abs(p.x - q.x)); h = Math.max(h, Math.abs(p.y - q.y));
  }
  w *= margin; h *= margin;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  Object.assign(cam, { left: -w, right: w, top: h, bottom: -h, near: .1, far: r * 10 });
  cam.updateProjectionMatrix();
}

export class Studio {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera();
  private axes = new THREE.AxesHelper(100);
  private lights = new THREE.Group();
  private depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  private target = new THREE.WebGLRenderTarget(MASK, MASK);
  private envMap: THREE.Texture;

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pm.fromScene(new RoomEnvironment(), .04).texture;
    pm.dispose();
    this.lights.add(new THREE.HemisphereLight(0xf2f5ff, 0x2a2622, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-1, -1.4, 2.2); this.lights.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, .9); fill.position.set(1.4, 1, .6); this.lights.add(fill);
    this.scene.add(this.lights, this.axes);
    this.axes.renderOrder = 10;
    (this.axes.material as THREE.Material).depthTest = false;
  }

  // Renders objects into the shared canvas. Objects are borrowed from their own scene for the call.
  draw(objects: THREE.Object3D[], opts: { view: View; section?: boolean; width: number; height: number; box?: THREE.Box3;
    background?: THREE.ColorRepresentation | null; axes?: boolean; env?: boolean; under?: THREE.Object3D[]; margin?: number }): HTMLCanvasElement {
    const { view, width, height } = opts, dir = new THREE.Vector3(...VIEW_DIRS[view]).normalize();
    const r = this.renderer;
    r.setSize(width, height, false);
    const box = opts.box ?? REF_BOX;
    frameOrtho(this.cam, box, dir, width / height, opts.margin);
    this.scene.background = opts.background === null ? null : new THREE.Color(opts.background ?? 0xe9ebee);
    this.scene.environment = opts.env === false ? null : this.envMap;
    this.scene.environmentIntensity = .55;
    this.axes.visible = opts.axes !== false;
    r.clippingPlanes = opts.section ? [new THREE.Plane(dir.clone().negate(), 0)] : [];
    if (opts.under?.length) {
      r.autoClear = false;
      r.clear();
      this.borrow(opts.under, () => r.render(this.scene, this.cam));
      r.clearDepth();
      const bg = this.scene.background;
      this.scene.background = null;
      this.borrow(objects, () => r.render(this.scene, this.cam));
      this.scene.background = bg;
      r.autoClear = true;
    } else this.borrow(objects, () => r.render(this.scene, this.cam));
    r.clippingPlanes = [];
    return r.domElement;
  }

  // Base64 PNG for a tool result.
  png(objects: THREE.Object3D[], view: View, section: boolean, box: THREE.Box3): string {
    return this.draw(objects, { view, section, width: 800, height: 600, box }).toDataURL('image/png').split(',')[1];
  }

  // Depth from each scored side, in mm from the camera, framed on the reference box. NaN where empty.
  depthMaps(objects: THREE.Object3D[]): Float32Array[] {
    const r = this.renderer, out: Float32Array[] = [];
    const bg = this.scene.background, env = this.scene.environment;
    this.scene.background = null; this.scene.environment = null;
    this.scene.overrideMaterial = this.depth;
    this.axes.visible = false;
    const pixels = new Uint8Array(MASK * MASK * 4);
    r.setClearColor(0xffffff, 1);
    this.borrow(objects, () => {
      for (const v of SCORE_VIEWS) {
        frameOrtho(this.cam, REF_BOX, new THREE.Vector3(...VIEW_DIRS[v]).normalize(), 1, 1.12);
        r.setRenderTarget(this.target);
        r.clear();
        r.render(this.scene, this.cam);
        r.readRenderTargetPixels(this.target, 0, 0, MASK, MASK, pixels);
        const d = new Float32Array(MASK * MASK), span = this.cam.far - this.cam.near;
        for (let i = 0; i < d.length; i++) {
          const o = i * 4;
          if (pixels[o] === 255 && pixels[o + 1] === 255 && pixels[o + 2] === 255 && pixels[o + 3] === 255) { d[i] = NaN; continue; }
          // three's RGBA depth packing: r is the coarsest byte
          const z = pixels[o] / 255 + pixels[o + 1] / 65025 + pixels[o + 2] / 16581375 + pixels[o + 3] / 4228250625;
          d[i] = this.cam.near + z * span;
        }
        out.push(d);
      }
      r.setRenderTarget(null);
    });
    r.setClearColor(0x000000, 0);
    this.scene.overrideMaterial = null;
    this.scene.background = bg; this.scene.environment = env;
    return out;
  }

  private borrow(objects: THREE.Object3D[], fn: () => void) {
    const homes = objects.map(o => [o, o.parent] as const);
    for (const o of objects) {
      this.scene.add(o);
      o.traverse(m => { if (m.userData.born !== undefined) m.scale.setScalar(1); });
    }
    try { fn(); } finally { for (const [o, home] of homes) { if (home) home.add(o); else this.scene.remove(o); } }
  }
}

// Silhouette overlap: shared covered pixels over all covered pixels.
export function overlap(a: Float32Array, b: Float32Array): number {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] === a[i], y = b[i] === b[i]; if (x && y) inter++; if (x || y) uni++; }
  return uni ? inter / uni : 0;
}

// Surface match: pixels where both surfaces are within tol mm, over all covered pixels.
export function surface(a: Float32Array, b: Float32Array, tol = 10): number {
  let hit = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] === a[i], y = b[i] === b[i];
    if (x || y) uni++;
    if (x && y && Math.abs(a[i] - b[i]) <= tol) hit++;
  }
  return uni ? hit / uni : 0;
}
