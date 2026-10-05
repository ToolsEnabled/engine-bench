// What every provider loop shares: the clock, usage and cost, the safety stop and tool dispatch.
// There is no budget. Each agent gets one prompt and runs until it is done; cost, tokens and time
// are measured, not capped.
import type { Provider } from '../providers';
import type { Call } from '../records';

export type Effort = '' | 'low' | 'medium' | 'high' | 'xhigh'; // '' = the model's own default
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number } // USD per million tokens
export interface AgentSpec {
  provider: Provider; model: string; label: string; key: string; price: Price | null;
  vision: boolean | null; // null: not known in advance
  maxOut: number | null;  // the model's output limit per turn, when known
}
export interface ToolOutcome { text: string; image?: string; isError?: boolean; finished?: string }
export interface Events {
  status(s: string): void;
  text(delta: string): void;
  thought(delta: string): void;
  call(name: string, input: unknown, out: ToolOutcome): void;
  usage(): void;
}
export type Executor = (name: string, input: unknown) => Promise<ToolOutcome>;

// Only guards against a runaway loop on the visitor's key. The same for every agent, and not in the prompt.
export const SAFETY = { turns: 150, minutes: 90 };
export const KICKOFF = 'Build the engine.';

export class Run {
  turn = 0;
  usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  billed: number | null = null; // cost reported by the provider itself (OpenRouter), when given
  readonly calls: Call[] = [];
  readonly started: number;
  readonly startedISO: string;
  ended = 0;
  reason = '';
  summary = '';
  error = '';
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;

  constructor(readonly spec: AgentSpec, readonly effort: Effort, readonly system: string, private exec: Executor, readonly on: Events,
    start = { ms: performance.now(), iso: new Date().toISOString() }) {
    this.started = start.ms; this.startedISO = start.iso;
    this.timer = setTimeout(() => this.stop('safety'), SAFETY.minutes * 60_000);
  }

  get signal() { return this.controller.signal; }
  get done() { return this.ended > 0; }
  elapsed() { return (this.ended || performance.now()) - this.started; }

  cost(): number | null {
    if (this.billed !== null) return this.billed;
    const p = this.spec.price;
    if (!p) return null;
    const u = this.usage;
    return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
  }

  // Why the run must not make another model call, or null if it may.
  limit(): string | null {
    if (this.signal.aborted) return this.reason || 'stopped';
    if (this.turn >= SAFETY.turns) return 'safety';
    return null;
  }

  add(u: Partial<Usage>, billed?: number) {
    for (const k of Object.keys(u) as (keyof Usage)[]) this.usage[k] += u[k] ?? 0;
    if (typeof billed === 'number' && Number.isFinite(billed)) this.billed = (this.billed ?? 0) + billed;
    this.on.usage();
  }

  async tool(name: string, input: unknown): Promise<ToolOutcome> {
    const call: Call = { ms: this.elapsed(), name, input: name === 'finish' ? {} : structuredClone(input ?? null), error: false };
    this.calls.push(call);
    let out: ToolOutcome;
    try { out = await this.exec(name, input); }
    catch (e) { out = { text: `The tool failed: ${(e as Error).message}`, isError: true }; }
    call.error = !!out.isError;
    this.on.call(name, input, out);
    return out;
  }

  stop(reason: string) {
    if (this.done) return;
    this.reason = reason;
    this.controller.abort();
  }

  skip(name: string, input: unknown) {
    this.calls.push({ ms: this.elapsed(), name, input: name === 'finish' ? {} : structuredClone(input ?? null), error: true, skipped: true });
  }

  finish(reason: string, extra: { summary?: string; error?: string } = {}) {
    if (this.done) return;
    clearTimeout(this.timer);
    this.reason = this.reason || reason;
    Object.assign(this, extra);
    this.ended = performance.now();
    this.on.usage();
  }
}

export const REASONS: Record<string, string> = {
  finished: 'Finished', ended: 'Finished', stopped: 'Stopped by you', safety: 'Safety stop',
  declined: 'Declined the task', error: 'Error',
};
