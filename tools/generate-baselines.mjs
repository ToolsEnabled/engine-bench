import { build } from 'esbuild';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const temp = await mkdtemp(resolve('.baseline-build-'));
let baselines;
try {
  const file = `${temp}/baselines.mjs`;
  await build({ entryPoints: ['tools/baselines.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: file });
  ({ baselines } = await import(pathToFileURL(file).href));
} finally { await rm(temp, { recursive: true, force: true }); }
const goal = JSON.parse(await readFile('site/static/bench/goal/engine-goal-v1.json', 'utf8'));
const records = await baselines(goal.bin), dir = 'site/static/bench/results';
await mkdir(dir, { recursive: true });
for (const record of records) await writeFile(`${dir}/${record.model}.json`, JSON.stringify(record, null, 2) + '\n');
const path = `${dir}/leaderboard.json`;
let existing = [];
try { const data = JSON.parse(await readFile(path, 'utf8')); existing = Array.isArray(data) ? data : data.entries; } catch (e) { if (e.code !== 'ENOENT') throw e; }
const entries = records.map(r => ({ model: r.model, label: r.label, provider: r.provider, score: null, silhouette: null, surface: null, dims: null, coverage: null,
  parts: r.parts, ms: r.ms, cost: 0, tokens: 0, date: r.started, record: `/static/bench/results/${r.model}.json`, kind: 'baseline',
  note: 'WebGL was unavailable during generation. Check this record in a browser to fill its score.' }));
await writeFile(path, JSON.stringify([...existing.filter(e => e.kind === 'model'), ...entries], null, 2) + '\n');
console.log(records.map(r => `${r.model}: ${r.parts} parts, ${r.calls.length} calls; score pending WebGL`).join('\n'));
