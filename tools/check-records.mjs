import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const temp = await mkdtemp(resolve('.record-check-'));
try {
const file = `${temp}/check.mjs`;

await build({ bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: file, stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Run } from './src/agents/common';
import { Workspace } from './src/workspace';
import { fingerprint, record, readRecords, replay } from './src/records';
import { models } from './src/leaderboard';

const prompt = await fingerprint();
assert.equal(prompt, 'b131db1ab5db');
for (const [file, hash] of Object.entries({
  'src/specs.ts': 'd6b074559fdd8a0007f4be327b5f359e68afc3f9198c11155b0fcfd542b1995b',
  'src/tools.ts': '6e09bebaeb372d42f6521e82c6789ade271e4ac7508c1f14fc201eb76b46cc97',
  'src/score.ts': 'a15b085889e0a3aeafc40e977c961d88099ed659d6dabc15d4198ab1376cee0f',
})) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, file + ' must stay frozen for 0.1');
const goal = JSON.parse(await readFile('site/static/bench/goal/engine-goal-v1.json', 'utf8')).bin;
const events = { status() {}, text() {}, thought() {}, call() {}, usage() {} };
const spec = { provider: 'mock', model: 'test-box', label: 'Test script (box)', key: 'private-test-key', price: null, vision: true, maxOut: null };
const ws = new Workspace(() => run.elapsed());
const run = new Run(spec, 'high', 'private-system-text', async (name, input) => {
  if (name === 'add_parts') { const out = await ws.add(input); if (input.failAfter) throw new Error('failure after applying'); return out; }
  if (name === 'remove_parts') return ws.remove(input);
  return { text: 'private-tool-output', finished: 'private-summary' };
}, events);
const part = id => ({ id, subsystem: 'block', role: 'block', shape: { type: 'box', size: [10, 20, 30] }, position: [1, 2, 3] });
const input = { parts: [part('kept'), { ...part('invalid'), shape: { type: 'unknown' } }] };
await run.tool('add_parts', input);
input.parts[0].position[0] = 999;
await run.tool('add_parts', { parts: [{ ...part('kept'), position: [20, 30, 40] }, part('removed')] });
await run.tool('remove_parts', { ids: ['removed', 'missing'] });
await run.tool('remove_parts', { ids: ['missing'] });
await run.tool('add_parts', { parts: [part('after_error')], failAfter: true });
await run.tool('finish', { summary: 'private-summary' });
run.skip('add_parts', { parts: [part('never_added')] });
run.skip('add_parts', null);
run.turn = 3; run.add({ input: 100, cacheRead: 20, output: 10 }); run.finish('finished');
const result = record(run, prompt, goal, { total: 10, silhouette: 0, surface: 0, dims: 0, coverage: 0, roles: 0, checks: [] }, ws.parts.size);
assert.equal(result.calls.length, 8);
assert.equal(result.calls[7].input, null);
assert.equal(result.calls[6].skipped, true);
assert.equal(result.calls[0].input.parts[0].position[0], 1);
assert.equal(result.calls[3].error, true);
assert.equal(result.calls[4].error, true);
assert.deepEqual(result.calls[5].input, {});
const json = JSON.stringify(result);
for (const secret of ['private-test-key', 'private-system-text', 'private-tool-output', 'private-summary']) assert(!json.includes(secret));
const race = readRecords({ date: result.started, records: [result, result] }, prompt, goal);
assert.equal(race.records.length, 2);
const replayed = await replay(readRecords(result, prompt, goal).records[0]);
assert.deepEqual([...replayed.parts.keys()], [...ws.parts.keys()]);
for (const [id, p] of ws.parts) {
  assert.deepEqual([replayed.parts.get(id).box.min.toArray(), replayed.parts.get(id).box.max.toArray()], [p.box.min.toArray(), p.box.max.toArray()]);
  assert.equal(replayed.parts.get(id).role, p.role);
}
assert.throws(() => readRecords({ ...result, prompt: '000000000000' }, prompt, goal), /prompt/);
assert.throws(() => readRecords({ ...result, bench: '0.2' }, prompt, goal), /version/);
assert.throws(() => readRecords({ ...result, goal: 'wrong.bin.gz' }, prompt, goal), /goal/);
assert.throws(() => readRecords({ ...result, calls: [...result.calls].reverse() }, prompt, goal), /order/);
assert.throws(() => readRecords({ ...result, provider: 'a-provider', score: null }, prompt, goal), /invalid/);
assert.deepEqual(models([{ kind: 'baseline', score: 100 }, { kind: 'model', score: 20 }, { kind: 'model', score: 50 }]).map(e => e.score), [50, 20]);
const expected = { 'test-full': 53, 'test-half': 35, 'test-box': 1 };
for (const [model, count] of Object.entries(expected)) {
  const r = readRecords(JSON.parse(await readFile('site/static/bench/results/' + model + '.json', 'utf8')), prompt, goal).records[0];
  const w = await replay(r);
  assert.equal(w.parts.size, count); assert.equal(w.parts.size, r.parts);
  assert.deepEqual(r.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }); assert.equal(r.cost, 0);
  w.dispose();
}
ws.dispose(); replayed.dispose();
console.log('Frozen files, record privacy, exact inputs, replacement/removal, partial failures, skipped calls, identity checks, model ranking and all three baseline replays passed.');
` } });
await import(pathToFileURL(file).href);
} finally { await rm(temp, { recursive: true, force: true }); }
