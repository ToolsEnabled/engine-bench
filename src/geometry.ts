// Primitive solids and cuts for the agents' parts. Every input is checked here,
// because tool inputs are untrusted model output.
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { LIMITS } from './tools';

export class SpecError extends Error {}
const fail = (m: string): never => { throw new SpecError(m); };

export type V3 = [number, number, number];

export function num(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(`${what} must be a number from ${min} to ${max}`);
  return v as number;
}

export function vec3(v: unknown, what: string, fallback?: V3): V3 {
  if (v === undefined || v === null) return fallback ?? fail(`${what} is required`);
  if (!Array.isArray(v) || v.length !== 3) fail(`${what} must be [x, y, z]`);
  return (v as unknown[]).map((x, i) => num(x, `${what}[${i}]`, -LIMITS.coord, LIMITS.coord)) as V3;
}

const Z_UP = new THREE.Matrix4().makeRotationX(Math.PI / 2); // three's round shapes run along Y; ours run along Z

function points(v: unknown, what: string, radial: boolean): THREE.Vector2[] {
  if (!Array.isArray(v) || v.length < 3 || v.length > LIMITS.points) fail(`${what} needs 3 to ${LIMITS.points} points`);
  const pts = (v as unknown[]).map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) fail(`${what}[${i}] must be [a, b]`);
    const q = p as unknown[];
    return new THREE.Vector2(num(q[0], `${what}[${i}][0]`, radial ? 0 : -LIMITS.coord, LIMITS.coord), num(q[1], `${what}[${i}][1]`, -LIMITS.coord, LIMITS.coord));
  });
  if (Math.abs(THREE.ShapeUtils.area(pts)) < 1e-3) fail(`${what} encloses no area`);
  return pts;
}

export function shapeGeometry(s: unknown, what: string): THREE.BufferGeometry {
  if (!s || typeof s !== 'object') fail(`${what} must be an object`);
  const o = s as Record<string, unknown>, L = LIMITS.coord;
  const seg = o.segments === undefined ? 32 : Math.round(num(o.segments, `${what}.segments`, 8, LIMITS.segments));
  switch (o.type) {
    case 'box': {
      const [x, y, z] = vec3(o.size, `${what}.size`);
      if (x <= 0 || y <= 0 || z <= 0) fail(`${what}.size values must be positive`);
      return new THREE.BoxGeometry(x, y, z);
    }
    case 'cylinder': case 'cone': {
      const r = num(o.radius, `${what}.radius`, 0, L), h = num(o.height, `${what}.height`, 0.01, 2 * L);
      const top = o.radius_top === undefined ? (o.type === 'cone' ? 0 : r) : num(o.radius_top, `${what}.radius_top`, 0, L);
      if (r <= 0 && top <= 0) fail(`${what} needs a positive radius`);
      return new THREE.CylinderGeometry(top, r, h, seg).applyMatrix4(Z_UP);
    }
    case 'tube': {
      const r = num(o.radius, `${what}.radius`, 0.01, L), ri = num(o.inner_radius, `${what}.inner_radius`, 0, L), h = num(o.height, `${what}.height`, 0.01, 2 * L);
      if (ri >= r) fail(`${what}.inner_radius must be smaller than radius`);
      const p = [new THREE.Vector2(ri, -h / 2), new THREE.Vector2(r, -h / 2), new THREE.Vector2(r, h / 2), new THREE.Vector2(ri, h / 2), new THREE.Vector2(ri, -h / 2)];
      return new THREE.LatheGeometry(p, seg).applyMatrix4(Z_UP);
    }
    case 'sphere': return new THREE.SphereGeometry(num(o.radius, `${what}.radius`, 0.01, L), seg, Math.max(6, seg >> 1));
    case 'torus': {
      const r = num(o.radius, `${what}.radius`, 0.01, L), t = num(o.tube, `${what}.tube`, 0.01, L);
      return new THREE.TorusGeometry(r, t, Math.max(8, seg >> 1), seg);
    }
    case 'extrude': {
      const h = num(o.height, `${what}.height`, 0.01, 2 * L);
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(points(o.points, `${what}.points`, false)), { depth: h, bevelEnabled: false, curveSegments: 1 });
      return g.translate(0, 0, -h / 2);
    }
    case 'revolve': {
      const p = points(o.points, `${what}.points`, true);
      if (THREE.ShapeUtils.isClockWise(p)) p.reverse(); // counter-clockwise in (r, z) gives outward faces
      if (!p[0].equals(p[p.length - 1])) p.push(p[0].clone());
      return new THREE.LatheGeometry(p, seg).applyMatrix4(Z_UP);
    }
    default: return fail(`${what}.type must be one of box, cylinder, cone, tube, sphere, torus, extrude, revolve`);
  }
}

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = false;

function placed(geometry: THREE.BufferGeometry, position: V3, rotation: V3): Brush {
  const b = new Brush(geometry);
  b.position.set(...position);
  b.rotation.set(...rotation.map(THREE.MathUtils.degToRad) as V3, 'XYZ');
  b.updateMatrixWorld();
  return b;
}

// The part's local geometry with every cut applied, flat-free CAD shading.
export function partGeometry(shape: unknown, cuts: unknown, what: string): THREE.BufferGeometry {
  let g = shapeGeometry(shape, `${what}.shape`);
  if (cuts !== undefined && cuts !== null) {
    if (!Array.isArray(cuts) || cuts.length > LIMITS.cuts) fail(`${what}.cuts must be a list of up to ${LIMITS.cuts}`);
    let brush = placed(g, [0, 0, 0], [0, 0, 0]);
    (cuts as unknown[]).forEach((c, i) => {
      const w = `${what}.cuts[${i}]`;
      if (!c || typeof c !== 'object') fail(`${w} must be an object`);
      const cut = c as Record<string, unknown>;
      const tool = placed(shapeGeometry(cut.shape, `${w}.shape`), vec3(cut.position, `${w}.position`, [0, 0, 0]), vec3(cut.rotation, `${w}.rotation`, [0, 0, 0]));
      brush = evaluator.evaluate(brush, tool, SUBTRACTION);
    });
    g = brush.geometry;
  }
  return creased(g);
}

// Smooth across gentle angles, sharp across edges, like the reference CAD meshes.
export function creased(src: THREE.BufferGeometry, degrees = 35): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src;
  const pos = g.getAttribute('position') as THREE.BufferAttribute, n = pos.count, tri = n / 3;
  const face = new Float32Array(tri * 3), area = new Float32Array(tri * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < tri; f++) {
    a.fromBufferAttribute(pos, f * 3); b.fromBufferAttribute(pos, f * 3 + 1); c.fromBufferAttribute(pos, f * 3 + 2);
    b.sub(a); c.sub(a); b.cross(c);
    area[f * 3] = b.x; area[f * 3 + 1] = b.y; area[f * 3 + 2] = b.z;
    const l = b.length() || 1;
    face[f * 3] = b.x / l; face[f * 3 + 1] = b.y / l; face[f * 3 + 2] = b.z / l;
  }
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e3)},${Math.round(pos.getY(i) * 1e3)},${Math.round(pos.getZ(i) * 1e3)}`;
  const shared = new Map<string, number[]>();
  for (let i = 0; i < n; i++) { const k = key(i); const l = shared.get(k); if (l) l.push(i); else shared.set(k, [i]); }
  const normal = new Float32Array(n * 3), cos = Math.cos(degrees * Math.PI / 180);
  for (const corners of shared.values()) for (const i of corners) {
    const fi = (i / 3 | 0) * 3; let x = 0, y = 0, z = 0;
    for (const j of corners) {
      const fj = (j / 3 | 0) * 3;
      if (face[fi] * face[fj] + face[fi + 1] * face[fj + 1] + face[fi + 2] * face[fj + 2] >= cos) { x += area[fj]; y += area[fj + 1]; z += area[fj + 2]; }
    }
    const l = Math.hypot(x, y, z) || 1;
    normal[i * 3] = x / l; normal[i * 3 + 1] = y / l; normal[i * 3 + 2] = z / l;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', pos.clone());
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
