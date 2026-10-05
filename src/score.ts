// The score, 0 to 100: 25% silhouette, 20% surface, 35% key dimensions, 20% role coverage.
import * as THREE from 'three';
import { ROLES, TRUTH, type Role } from './specs';
import { overlap, surface as surfaceMatch } from './studio';

export interface Tagged { role: Role | null; box: THREE.Box3 }
export interface Score {
  total: number; silhouette: number; surface: number; dims: number; coverage: number;
  checks: { name: string; value: string; target: string; score: number }[];
  roles: number; // roles present
}

const near = (value: number, target: number, tolerance: number) => Math.max(0, 1 - Math.abs(value - target) / tolerance);
const mm = (v: number) => `${Math.round(v)} mm`;

export function score(parts: Iterable<Tagged>, maps: Float32Array[], refMaps: Float32Array[]): Score {
  const all = [...parts], byRole = new Map<Role, THREE.Box3[]>();
  const box = new THREE.Box3();
  for (const p of all) { box.union(p.box); if (p.role) byRole.set(p.role, [...(byRole.get(p.role) ?? []), p.box]); }
  const checks: Score['checks'] = [];

  const pistons = byRole.get('piston') ?? [];
  checks.push({ name: 'Cylinders', value: String(pistons.length), target: '4', score: pistons.length ? near(pistons.length, TRUTH.cylinders, TRUTH.cylinders) : 0 });

  const dia = pistons.map(b => { const s = b.getSize(new THREE.Vector3()); return (s.x + s.y) / 2; });
  const bore = dia.length ? dia.reduce((a, b) => a + b) / dia.length : NaN;
  checks.push({ name: 'Bore', value: dia.length ? mm(bore) : 'none', target: '75 mm', score: dia.length ? near(bore, TRUTH.bore, TRUTH.bore * .2) : 0 });

  const xs = pistons.map(b => b.getCenter(new THREE.Vector3()).x).sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  const pitch = gaps.length ? gaps.reduce((a, b) => a + b) / gaps.length : NaN;
  checks.push({ name: 'Bore spacing', value: gaps.length ? mm(pitch) : 'none', target: '84 mm', score: gaps.length ? near(pitch, TRUTH.pitch, TRUTH.pitch * .2) : 0 });

  const crank = byRole.get('crankshaft')?.reduce((a, b) => a.clone().union(b));
  const crankZ = crank ? crank.getCenter(new THREE.Vector3()).z : NaN;
  checks.push({ name: 'Crank height', value: crank ? `Z ${Math.round(crankZ)}` : 'none', target: 'Z -212', score: crank ? near(crankZ, TRUTH.crankZ, Math.abs(TRUTH.crankZ) * .2) : 0 });

  const valves = (byRole.get('intake_valve')?.length ?? 0) + (byRole.get('exhaust_valve')?.length ?? 0);
  checks.push({ name: 'Valves', value: String(valves), target: '16', score: valves ? near(valves, TRUTH.valves, TRUTH.valves) : 0 });

  const ref = new THREE.Vector3().subVectors(new THREE.Vector3(...TRUTH.bounds[1]), new THREE.Vector3(...TRUTH.bounds[0]));
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  const err = (Math.abs(size.x - ref.x) / ref.x + Math.abs(size.y - ref.y) / ref.y + Math.abs(size.z - ref.z) / ref.z) / 3;
  checks.push({ name: 'Overall size', value: box.isEmpty() ? 'none' : `${Math.round(size.x)}×${Math.round(size.y)}×${Math.round(size.z)}`, target: `${Math.round(ref.x)}×${Math.round(ref.y)}×${Math.round(ref.z)}`, score: box.isEmpty() ? 0 : near(err, 0, .3) });

  const silhouette = [0, 1, 2].reduce((a, k) => a + overlap(maps[k], refMaps[k]), 0) / 3;
  const surface = maps.reduce((a, m, k) => a + surfaceMatch(m, refMaps[k]), 0) / maps.length;
  const dims = checks.reduce((a, c) => a + c.score, 0) / checks.length;
  const roles = ROLES.filter(r => byRole.has(r)).length;
  const coverage = roles / ROLES.length;
  const total = 100 * (.25 * silhouette + .2 * surface + .35 * dims + .2 * coverage);
  return { total, silhouette, surface, dims, coverage, checks, roles };
}
