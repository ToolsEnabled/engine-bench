// A live 3D view on the page: the goal in the hero, and each agent's model in the arena.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 1, 20000);
  readonly controls: OrbitControls;
  readonly content = new THREE.Group();
  readonly under = new THREE.Scene(); // drawn first, then the model on top: the goal overlay
  private rim: THREE.DirectionalLight;
  private rimPower: number;
  private visible = true;
  private running = false;
  private last = 0;

  constructor(private canvas: HTMLCanvasElement, opts: { autoRotate?: boolean; interactive?: boolean; rim?: number } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture;
    this.scene.environmentIntensity = .5;
    pm.dispose();
    this.camera.up.set(0, 0, 1);
    this.scene.add(new THREE.HemisphereLight(0xf0f3ff, 0x221c1c, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-1, -1.4, 2.2);
    const fill = new THREE.DirectionalLight(0xdfe8ff, .7); fill.position.set(1.4, 1, .6);
    this.rimPower = opts.rim ?? 2.4;
    this.rim = new THREE.DirectionalLight(0xff2a3a, this.rimPower); this.rim.position.set(1.2, 1.6, -.4);
    this.scene.add(key, fill, this.rim, this.content);
    this.under.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
    const ukey = new THREE.DirectionalLight(0xffffff, 1.2); ukey.position.set(-1, -1.4, 2.2); this.under.add(ukey);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.autoRotate = !!opts.autoRotate;
    this.controls.autoRotateSpeed = .6;
    this.controls.enabled = opts.interactive !== false;
    this.controls.enableZoom = opts.interactive !== false;
    new IntersectionObserver(es => { this.visible = es[0].isIntersecting; if (this.visible) this.start(); }).observe(canvas);
    this.frame(new THREE.Box3(new THREE.Vector3(-330, -270, -380), new THREE.Vector3(270, 280, 170)));
  }

  setTheme(dark: boolean) { this.rim.intensity = dark ? this.rimPower : this.rimPower / 4; }

  frame(box: THREE.Box3, dir = new THREE.Vector3(1.1, -1.35, .75)) {
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    const d = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * .92;
    this.camera.position.copy(c).addScaledVector(dir.normalize(), d);
    this.controls.target.copy(c);
    this.camera.near = d / 50; this.camera.far = d * 6;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = (t: number) => {
      if (!this.visible || !this.canvas.isConnected) { this.running = false; return; }
      requestAnimationFrame(tick);
      if (t - this.last < 14) return;
      this.last = t;
      this.draw();
    };
    requestAnimationFrame(tick);
  }

  draw() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const now = performance.now();
    this.content.traverse(o => {
      const born = o.userData.born as number | undefined;
      if (born === undefined) return;
      const t = Math.min(1, (now - born) / 520);
      o.scale.setScalar(t >= 1 ? 1 : Math.max(.001, easeOutBack(t)));
    });
    this.controls.update();
    this.renderer.clear();
    if (this.under.children.some(o => o.visible && !(o instanceof THREE.Light))) {
      this.renderer.render(this.under, this.camera);
      this.renderer.clearDepth();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
