// Builds the goal engine for the web bench from the reference CAD scene.
// Every body stays a separate part with its own pose. Only the display meshes
// are simplified and quantized so the page stays small; the published CAD
// model keeps the full meshes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { MeshoptSimplifier } from 'meshoptimizer';

const SRC = process.env.GOAL_SRC;
if (!SRC) throw new Error('Set GOAL_SRC to the folder that holds the reference scene.json and meshes/.');
const OUT = process.env.GOAL_OUT || 'site/static/bench/goal';
const RATIO = Number(process.env.GOAL_RATIO || 0.06);
const ERROR = Number(process.env.GOAL_ERROR || 0.004);

// Subsystem of each reference part, first match wins.
const SUBSYSTEMS = [
  ['valvetrain', /^(intake|exhaust)_0\d_|^rocker_shaft|^lost_motion|^valve_(guide|stem_seal|oil_orifice)|^spool_|^solenoid_bolt|^valve_timing_pressure_switch|^pressure_switch_oring/],
  ['pistons_rods', /^(piston|wrist_pin|pin_clip|top_ring|second_ring|oil_ring|rod)(_|$)/],
  ['crankshaft', /^(crankshaft|crank_|flywheel|clutch_|pressure_(plate|cover|diaphragm|strap)|front_crank_seal|rear_crank_seal|rear_seal_housing|main_bearing)/],
  ['camshaft_timing', /^(camshaft|cam_|timing_|tensioner_|belt_tensioner|carrier_|holder_dowel)/],
  ['ignition', /^(spark_plug|distributor|ignition_|plug_tube)/],
  ['fuel', /^(fuel_|injector_)/],
  ['intake', /^(intake_|throttle_|idle_|fast_idle|map_|breather|pcv_|purge_)/],
  ['exhaust', /^(exhaust_|oxygen_sensor)/],
  ['lubrication', /^(oil_|dipstick)/],
  ['cooling', /^(water_|thermostat|coolant_)/],
  ['accessories', /^(ps_|engine_hanger)/],
  ['head', /^(head_casting|valve_cover|cover_|gasket)/],
  ['block', /^(block_casting|cylinder_liner|main_cap|core_plug|dowel|transmission_dowel)/],
  ['fasteners', /^(bolt|washer)_/],
];
const subsystemOf = id => (SUBSYSTEMS.find(([, re]) => re.test(id)) || ['other'])[0];
// Public part names drop internal revision suffixes.
const publicId = id => id === 'gasket_old' ? 'head_gasket' : id.replace(/_old$/, '').replace(/_(\d\d)_old$/, '_$1');

function decode(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(0, true), f = dv.getUint32(4, true);
  if (buf.byteLength !== 8 + n * 12 + f * 12) throw new Error('bad mesh length');
  const xyz = new Float32Array(buf.buffer.slice(buf.byteOffset + 8, buf.byteOffset + 8 + n * 12));
  const idx = new Uint32Array(buf.buffer.slice(buf.byteOffset + 8 + n * 12, buf.byteOffset + 8 + n * 12 + f * 12));
  return { xyz, idx, n, f };
}

function compact(xyz, idx) {
  const map = new Int32Array(xyz.length / 3).fill(-1); let k = 0;
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) { const v = idx[i]; if (map[v] < 0) map[v] = k++; out[i] = map[v]; }
  const pos = new Float32Array(k * 3);
  for (let v = 0; v < map.length; v++) if (map[v] >= 0) pos.set(xyz.subarray(v * 3, v * 3 + 3), map[v] * 3);
  return { pos, idx: out };
}

await MeshoptSimplifier.ready;
const scene = JSON.parse(readFileSync(`${SRC}/scene.json`, 'utf8'));
const meshIndex = new Map(), meshes = [];
let srcTris = 0, outTris = 0;
for (const p of scene.parts) {
  const file = p.mesh.file;
  if (meshIndex.has(file)) continue;
  const { xyz, idx, f } = decode(readFileSync(`${SRC}/${file}`));
  srcTris += f;
  const target = Math.max(12, Math.round(f * RATIO)) * 3;
  let [simp] = MeshoptSimplifier.simplify(idx, xyz, 3, target, ERROR, ['Prune']);
  if (simp.length < 12) simp = idx; // tiny parts keep their mesh
  const c = compact(xyz, simp);
  outTris += c.idx.length / 3;
  meshIndex.set(file, meshes.length);
  meshes.push(c);
}

// Binary: per mesh, uint16 positions quantized to the mesh bounds, then indices.
const chunks = [], table = [];
let offset = 0;
const pad = () => { const r = offset % 4; if (r) { chunks.push(Buffer.alloc(4 - r)); offset += 4 - r; } };
for (const m of meshes) {
  const v = m.pos.length / 3, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v; i++) for (let a = 0; a < 3; a++) { const x = m.pos[i * 3 + a]; if (x < min[a]) min[a] = x; if (x > max[a]) max[a] = x; }
  const q = new Uint16Array(v * 3);
  for (let i = 0; i < v; i++) for (let a = 0; a < 3; a++) { const span = max[a] - min[a] || 1; q[i * 3 + a] = Math.round((m.pos[i * 3 + a] - min[a]) / span * 65535); }
  const wide = v > 65535, ind = wide ? m.idx : Uint16Array.from(m.idx);
  table.push({ v, i: m.idx.length, wide, min: min.map(x => +x.toFixed(6)), max: max.map(x => +x.toFixed(6)), pos: offset });
  chunks.push(Buffer.from(q.buffer)); offset += q.byteLength; pad();
  table.at(-1).ind = offset;
  chunks.push(Buffer.from(ind.buffer, ind.byteOffset, ind.byteLength)); offset += ind.byteLength; pad();
}
const bin = Buffer.concat(chunks), gz = gzipSync(bin, { level: 9 });
const binHash = createHash('sha256').update(gz).digest('hex').slice(0, 12);

const r3 = a => a.map(x => +x.toFixed(6));
const parts = scene.parts.map(p => ({
  id: publicId(p.id),
  sub: subsystemOf(p.id),
  mesh: meshIndex.get(p.mesh.file),
  p: r3(p.pose.position_m),
  q: r3(p.pose.quaternion_wxyz),
  rgba: r3(p.rgba),
  kg: +p.mass_kg.toFixed(5),
}));
const ids = new Set(parts.map(p => p.id));
if (ids.size !== parts.length) throw new Error('public ids collide');

const counts = {};
for (const p of parts) counts[p.sub] = (counts[p.sub] || 0) + 1;
const goal = {
  schema: 'engine-bench/goal/v1',
  title: '1.6 L SOHC inline-four, 16 valves',
  units: 'metres; Z up; X along the crankshaft, cylinder 1 at +X; origin on the deck face between cylinders 2 and 3',
  parts_total: parts.length,
  subsystems: counts,
  bounds_m: scene.bounds_m,
  bin: `engine-goal-v1.${binHash}.bin.gz`,
  bin_bytes: bin.length,
  meshes: table,
  parts,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/${goal.bin}`, gz);
writeFileSync(`${OUT}/engine-goal-v1.json`, JSON.stringify(goal));
console.log(JSON.stringify({ parts: parts.length, uniqueMeshes: meshes.length, srcTris, outTris, bin: bin.length, gz: gz.length, json: JSON.stringify(goal).length, counts }, null, 1));
const other = parts.filter(p => p.sub === 'other').map(p => p.id);
if (other.length) console.log('unassigned:', other.join(' '));
