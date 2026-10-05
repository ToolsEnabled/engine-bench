// Copies the reference CAD model into model/ for publishing: every part, full meshes,
// public names and poses only (no internal review or build metadata).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = process.env.GOAL_SRC;
if (!SRC) throw new Error('Set GOAL_SRC to the folder that holds the reference scene.json and meshes/.');
const goal = JSON.parse(readFileSync('site/static/bench/goal/engine-goal-v1.json', 'utf8'));
const scene = JSON.parse(readFileSync(`${SRC}/scene.json`, 'utf8'));
mkdirSync('model/meshes', { recursive: true });
const files = new Set();
const parts = scene.parts.map((p, i) => {
  const g = goal.parts[i];
  if (!files.has(p.mesh.file)) {
    const data = readFileSync(`${SRC}/${p.mesh.file}`);
    if (createHash('sha256').update(data).digest('hex') !== p.mesh.sha256) throw new Error('hash mismatch ' + p.mesh.file);
    copyFileSync(`${SRC}/${p.mesh.file}`, `model/${p.mesh.file}`);
    files.add(p.mesh.file);
  }
  return { id: g.id, subsystem: g.sub, mass_kg: +p.mass_kg.toFixed(6), position_m: p.pose.position_m, quaternion_wxyz: p.pose.quaternion_wxyz,
    rgba: p.rgba, mesh: p.mesh.file, sha256: p.mesh.sha256, triangles: p.mesh.triangles };
});
writeFileSync('model/parts.json', JSON.stringify({
  title: 'Reference engine: 1.6 L SOHC inline-four, 16 valves',
  parts_total: parts.length,
  units: 'metres, kilograms',
  frame: 'Z up along the cylinder axes; X along the crankshaft, cylinder 1 at +X (timing-belt end); intake side +Y; origin on the block deck face between cylinders 2 and 3.',
  mesh_format: 'little-endian: uint32 vertex count n, uint32 triangle count f, float32 positions[n*3] in the part frame (metres), uint32 indices[f*3]',
  pose: 'world = position_m + rotate(quaternion_wxyz, local)',
  bounds_m: scene.bounds_m,
  parts,
}, null, 1));
console.log(parts.length, 'parts,', files.size, 'mesh files');
