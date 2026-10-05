// World-space bounds (mm) of the reference parts that the spec pack and the score use.
import { readFileSync, writeFileSync } from 'node:fs';
const SRC = process.env.GOAL_SRC;
if (!SRC) throw new Error('Set GOAL_SRC to the folder that holds the reference scene.json and meshes/.');
const scene = JSON.parse(readFileSync(`${SRC}/scene.json`, 'utf8'));
const rot = ([w, x, y, z], [a, b, c]) => { // rotate vector by quaternion
  const ix = w * a + y * c - z * b, iy = w * b + z * a - x * c, iz = w * c + x * b - y * a, iw = -x * a - y * b - z * c;
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
const cache = new Map();
function bounds(p) {
  let xyz = cache.get(p.mesh.file);
  if (!xyz) { const b = readFileSync(`${SRC}/${p.mesh.file}`); const n = b.readUInt32LE(0); xyz = new Float32Array(b.buffer.slice(b.byteOffset + 8, b.byteOffset + 8 + n * 12)); cache.set(p.mesh.file, xyz); }
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < xyz.length; i += 3) {
    const v = rot(p.pose.quaternion_wxyz, [xyz[i], xyz[i + 1], xyz[i + 2]]);
    for (let a = 0; a < 3; a++) { const w = (v[a] + p.pose.position_m[a]) * 1000; lo[a] = Math.min(lo[a], w); hi[a] = Math.max(hi[a], w); }
  }
  return { lo: lo.map(x => +x.toFixed(1)), hi: hi.map(x => +x.toFixed(1)) };
}
const ROLES = {
  block: /^block_casting$/, head: /^head_casting$/, crankshaft: /^crankshaft$/, piston: /^piston_0\d$/,
  connecting_rod: /^rod_0\d$/, camshaft: /^camshaft$/, intake_valve: /^intake_0\d_valve_\d$/, exhaust_valve: /^exhaust_0\d_valve_\d$/,
  spark_plug: /^spark_plug_0\d$/, oil_pan: /^oil_pan$/, valve_cover: /^valve_cover$/, intake_manifold: /^intake_manifold$/,
  exhaust_manifold: /^exhaust_manifold$/, flywheel: /^flywheel$/, timing_belt: /^timing_belt$/, water_pump: /^water_pump_housing$/,
  distributor: /^distributor$/, fuel_rail: /^fuel_rail$/,
};
const out = { roles: {}, parts: scene.parts.length, bounds_mm: scene.bounds_m.map(v => v.map(x => +(x * 1000).toFixed(1))) };
for (const [role, re] of Object.entries(ROLES)) {
  const ps = scene.parts.filter(p => re.test(p.id));
  out.roles[role] = { count: ps.length, items: ps.map(p => ({ id: p.id, ...bounds(p) })) };
}
writeFileSync(process.env.OUT || 'goal-metrics.json', JSON.stringify(out, null, 1));
for (const [r, v] of Object.entries(out.roles)) console.log(r.padEnd(17), v.count, v.items.slice(0, 2).map(i => `${i.id} [${i.lo}]..[${i.hi}] size ${i.hi.map((h, k) => (h - i.lo[k]).toFixed(1))}`).join(' | '));
console.log('bounds', JSON.stringify(out.bounds_mm));
