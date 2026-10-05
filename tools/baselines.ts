import { Workspace } from '../src/workspace';
import { BENCH_VERSION } from '../src/version';
import { fingerprint, type Call, type RunRecord } from '../src/records';
import { script } from '../src/agents/mock';

export async function baselines(goal: string) {
  const prompt = await fingerprint(), records: RunRecord[] = [];
  for (const model of ['test-full', 'test-half', 'test-box']) {
    const started = new Date().toISOString(), t0 = performance.now(), ws = new Workspace(() => performance.now() - t0);
    const calls: Call[] = [], turns = script(model);
    for (const turn of turns) for (const [name, input] of turn.calls) {
      const c: Call = { ms: performance.now() - t0, name, input: name === 'finish' ? {} : structuredClone(input), error: false };
      calls.push(c);
      if (name === 'add_parts') c.error = (await ws.add(input)).isError;
      if (name === 'remove_parts') c.error = ws.remove(input).isError;
    }
    records.push({ bench: BENCH_VERSION, prompt, goal, provider: 'mock', model, label: ({ 'test-full': 'Baseline script: full spec', 'test-half': 'Baseline script: half', 'test-box': 'Baseline: one bounding box' } as Record<string, string>)[model], effort: '',
      started, ms: performance.now() - t0, turns: turns.length, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0, costSource: null, reason: 'finished', score: null, parts: ws.parts.size, calls });
    ws.dispose();
  }
  return records;
}
