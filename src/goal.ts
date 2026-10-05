// The goal: our reference engine, 894 separate parts, loaded from the packed display meshes.
import * as THREE from 'three';
import type { Role, Subsystem } from './specs';
import { materialFor } from './palette';

interface MeshEntry { v: number; i: number; wide: boolean; min: number[]; max: number[]; pos: number; ind: number }
interface GoalPart { id: string; sub: Subsystem; mesh: number; p: number[]; q: number[]; kg: number }
export interface GoalFile { title: string; parts_total: number; bin: string; bin_bytes: number; meshes: MeshEntry[]; parts: GoalPart[] }

const ROLE_OF: [Role, RegExp][] = [
  ['block', /^block_casting$/], ['head', /^head_casting$/], ['crankshaft', /^crankshaft$/], ['piston', /^piston_0\d$/],
  ['connecting_rod', /^rod_0\d$/], ['camshaft', /^camshaft$/], ['intake_valve', /^intake_0\d_valve_\d$/],
  ['exhaust_valve', /^exhaust_0\d_valve_\d$/], ['spark_plug', /^spark_plug_0\d$/], ['oil_pan', /^oil_pan$/],
  ['valve_cover', /^valve_cover$/], ['intake_manifold', /^intake_manifold$/], ['exhaust_manifold', /^exhaust_manifold$/],
  ['flywheel', /^flywheel$/], ['timing_belt', /^timing_belt$/], ['water_pump', /^water_pump_housing$/],
  ['distributor', /^distributor$/], ['fuel_rail', /^fuel_rail$/],
];

// Corner normals averaged over incident faces within the crease angle, as the CAD review does.
function creasedIndexed(xyz: Float32Array, idx: Uint16Array | Uint32Array, degrees = 35): THREE.BufferGeometry {
  const n = xyz.length / 3, f = idx.length / 3, deg = new Uint32Array(n + 1);
  for (const v of idx) deg[v + 1]++;
  for (let v = 0; v < n; v++) deg[v + 1] += deg[v];
  const cursor = deg.slice(0, n), incident = new Uint32Array(idx.length);
  const face = new Float32Array(f * 3), area = new Float32Array(f * 3);
  for (let t = 0; t < f; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = xyz[b] - xyz[a], uy = xyz[b + 1] - xyz[a + 1], uz = xyz[b + 2] - xyz[a + 2];
    const vx = xyz[c] - xyz[a], vy = xyz[c + 1] - xyz[a + 1], vz = xyz[c + 2] - xyz[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    area[t * 3] = nx; area[t * 3 + 1] = ny; area[t * 3 + 2] = nz;
    face[t * 3] = nx / l; face[t * 3 + 1] = ny / l; face[t * 3 + 2] = nz / l;
    for (let k = 0; k < 3; k++) incident[cursor[idx[t * 3 + k]]++] = t;
  }
  const pos = new Float32Array(idx.length * 3), nor = new Float32Array(idx.length * 3), cos = Math.cos(degrees * Math.PI / 180);
  for (let corner = 0; corner < idx.length; corner++) {
    const v = idx[corner], own = (corner / 3 | 0) * 3, o = corner * 3;
    pos[o] = xyz[v * 3]; pos[o + 1] = xyz[v * 3 + 1]; pos[o + 2] = xyz[v * 3 + 2];
    let x = 0, y = 0, z = 0;
    for (let j = deg[v]; j < deg[v + 1]; j++) {
      const t = incident[j] * 3;
      if (face[own] * face[t] + face[own + 1] * face[t + 1] + face[own + 2] * face[t + 2] >= cos) { x += area[t]; y += area[t + 1]; z += area[t + 2]; }
    }
    const l = Math.hypot(x, y, z) || 1;
    nor[o] = x / l; nor[o + 1] = y / l; nor[o + 2] = z / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

export interface GoalPartView { id: string; sub: Subsystem; role: Role | null; mesh: THREE.Mesh; box: THREE.Box3 }

export class Goal {
  readonly geometries: THREE.BufferGeometry[] = [];
  constructor(readonly file: GoalFile) {}

  static async load(base: string, progress?: (f: number) => void): Promise<Goal> {
    const file: GoalFile = await (await fetch(`${base}/engine-goal-v1.json`)).json();
    const res = await fetch(`${base}/${file.bin}`);
    if (!res.ok || !res.body) throw new Error('The goal engine did not load.');
    const total = Number(res.headers.get('content-length')) || 0;
    let seen = 0;
    const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) { seen += chunk.byteLength; if (total) progress?.(seen / total); ctl.enqueue(chunk); },
    }));
    const bin = await new Response(counted.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer();
    if (bin.byteLength !== file.bin_bytes) throw new Error('The goal engine file is damaged.');
    const goal = new Goal(file);
    for (const m of file.meshes) {
      const q = new Uint16Array(bin, m.pos, m.v * 3), xyz = new Float32Array(m.v * 3);
      for (let i = 0; i < m.v; i++) for (let a = 0; a < 3; a++) xyz[i * 3 + a] = m.min[a] + q[i * 3 + a] / 65535 * (m.max[a] - m.min[a]);
      const idx = m.wide ? new Uint32Array(bin, m.ind, m.i) : new Uint16Array(bin, m.ind, m.i);
      goal.geometries.push(creasedIndexed(xyz, idx));
    }
    return goal;
  }

  // A fresh group in millimetres. Pass a material to draw every part with it (the ghost).
  build(material?: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    g.scale.setScalar(1000);
    for (const p of this.file.parts) {
      const mesh = new THREE.Mesh(this.geometries[p.mesh], material ?? materialFor(p.sub));
      mesh.name = p.id;
      mesh.position.set(p.p[0], p.p[1], p.p[2]);
      mesh.quaternion.set(p.q[1], p.q[2], p.q[3], p.q[0]);
      g.add(mesh);
    }
    g.updateMatrixWorld(true);
    return g;
  }

  // The goal as tagged parts, so the score can check itself against the reference (it should be 100).
  views(group: THREE.Group): GoalPartView[] {
    group.updateMatrixWorld(true);
    return group.children.map((o, i) => {
      const mesh = o as THREE.Mesh, p = this.file.parts[i];
      return { id: p.id, sub: p.sub, role: (ROLE_OF.find(([, re]) => re.test(p.id)) || [null])[0], mesh, box: new THREE.Box3().setFromObject(mesh, true) };
    });
  }
}
