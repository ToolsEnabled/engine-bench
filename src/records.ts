import { BENCH_VERSION } from './version';
import { systemPrompt } from './specs';
import { TOOLS, LIMITS } from './tools';
import type { Score } from './score';
import type { Run, Effort, Usage } from './agents/common';
import { Workspace } from './workspace';

export interface Call { ms: number; name: string; input: unknown; error: boolean; skipped?: boolean }
export interface RunRecord {
  bench: typeof BENCH_VERSION; prompt: string; goal: string; provider: string; model: string; label: string; effort: Effort;
  started: string; ms: number; turns: number; usage: Usage; cost: number | null;
  costSource: 'provider' | 'list price' | null; reason: string; score: Score | null; parts: number; calls: Call[];
}
export interface RecordFile { date: string; records: RunRecord[] }

export async function fingerprint(): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ system: systemPrompt({ parts: LIMITS.parts, perCall: LIMITS.perCall }), tools: TOOLS })));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

export function record(run: Run, prompt: string, goal: string, score: Score, parts: number): RunRecord {
  return { bench: BENCH_VERSION, prompt, goal, provider: run.spec.provider, model: run.spec.model, label: run.spec.label,
    effort: run.effort, started: run.startedISO, ms: run.elapsed(), turns: run.turn, usage: { ...run.usage },
    cost: run.cost(), costSource: run.spec.provider === 'mock' ? null : run.billed !== null ? 'provider' : run.spec.price ? 'list price' : null,
    reason: run.reason, score, parts, calls: run.calls };
}

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, max = Number.MAX_SAFE_INTEGER) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const string = (v: unknown, max = 160) => typeof v === 'string' && v.length <= max;

export function readRecords(value: unknown, prompt: string, goal: string): RecordFile {
  const rows = object(value) && Array.isArray(value.records) ? value.records : [value];
  if (!rows.length || rows.length > 8) throw new Error('Choose a file with one to eight run records.');
  const records = rows.map((r: unknown) => {
    if (!object(r) || r.bench !== BENCH_VERSION || r.prompt !== prompt || r.goal !== goal)
      throw new Error(`The version, prompt or goal does not match Engine Bench ${BENCH_VERSION}.`);
    if (!['provider', 'model', 'label', 'reason'].every(k => string(r[k])) || !string(r.started) || !Number.isFinite(Date.parse(r.started))
      || !['', 'low', 'medium', 'high', 'xhigh'].includes(r.effort) || !number(r.ms) || !number(r.turns) || !number(r.parts, LIMITS.parts)
      || !(r.cost === null || number(r.cost)) || ![null, 'provider', 'list price'].includes(r.costSource)
      || !object(r.usage) || !['input', 'output', 'cacheRead', 'cacheWrite'].every(k => number(r.usage[k]))
      || !(r.score === null && r.provider === 'mock' && ['test-full', 'test-half', 'test-box'].includes(r.model)
        || object(r.score) && number(r.score.total, 100) && ['silhouette', 'surface', 'dims', 'coverage'].every(k => number(r.score[k], 1))
          && number(r.score.roles, 18) && Array.isArray(r.score.checks)
          && r.score.checks.every((c: unknown) => object(c) && string(c.name) && string(c.value) && string(c.target) && number(c.score, 1)))
      || !Array.isArray(r.calls) || r.calls.length > 20000)
      throw new Error('This run record is incomplete or invalid.');
    let last = 0;
    for (const c of r.calls) {
      if (!object(c) || !number(c.ms) || c.ms < last || c.ms > r.ms || !string(c.name) || typeof c.error !== 'boolean' || !('input' in c)
        || (c.skipped !== undefined && (c.skipped !== true || !c.error)))
        throw new Error('A tool call is invalid or out of order.');
      last = c.ms;
    }
    // Select only record fields; imported files cannot add keys or conversation text to downloads.
    return { bench: r.bench, prompt: r.prompt, goal: r.goal, provider: r.provider, model: r.model, label: r.label, effort: r.effort,
      started: r.started, ms: r.ms, turns: r.turns, usage: { input: r.usage.input, output: r.usage.output, cacheRead: r.usage.cacheRead, cacheWrite: r.usage.cacheWrite },
      cost: r.cost, costSource: r.costSource, reason: r.reason, score: r.score === null ? null : {
        total: r.score.total, silhouette: r.score.silhouette, surface: r.score.surface, dims: r.score.dims, coverage: r.score.coverage,
        roles: r.score.roles, checks: r.score.checks.map((c: Score['checks'][number]) => ({ name: c.name, value: c.value, target: c.target, score: c.score })),
      }, parts: r.parts,
      calls: r.calls.map((c: Call) => ({ ms: c.ms, name: c.name, input: c.name === 'finish' ? {} : c.input, error: c.error, ...(c.skipped ? { skipped: true } : {}) })) } as RunRecord;
  });
  const date = object(value) && string(value.date) && Number.isFinite(Date.parse(value.date)) ? value.date : records[0].started;
  return { date, records };
}

// Errors may still have changed a workspace, so every geometry call is replayed.
export async function replay(r: RunRecord, opts: { workspace?: Workspace; after?: (c: Call) => void; before?: (c: Call) => void; animate?: boolean } = {}): Promise<Workspace> {
  let time = 0;
  const ws = opts.workspace ?? new Workspace(() => time);
  const calls = r.calls.filter(c => !c.skipped && (c.name === 'add_parts' || c.name === 'remove_parts'));
  const t0 = performance.now(), duration = opts.animate ? 3200 : 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i], wait = t0 + duration * i / Math.max(1, calls.length) - performance.now();
    if (wait > 0) await new Promise(ok => setTimeout(ok, wait));
    time = c.ms; opts.before?.(c);
    try { if (c.name === 'add_parts') await ws.add(c.input); else ws.remove(c.input); } catch { /* preserve partial additions */ }
    opts.after?.(c);
  }
  return ws;
}
