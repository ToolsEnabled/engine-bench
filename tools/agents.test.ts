// Provider-loop and harness tests, run by tools/check-agents.mjs. No network: every model call goes to a
// scripted fake fetch, so these spend nothing and need no keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Namespace imports, so this file also loads against the 0.1 sources and shows which checks they fail.
import * as common from '../src/agents/common';
import * as chatLoop from '../src/agents/chat';
import { Run, REASONS, type AgentSpec, type Effort, type Events } from '../src/agents/common';
import { runClaude } from '../src/agents/anthropic';
import { runOpenAI } from '../src/agents/openai';
import { PROVIDERS } from '../src/providers';
import { Workspace } from '../src/workspace';
import { postText, type Result } from '../src/share';

const { runChat } = chatLoop;
const RETRY = (chatLoop as any).RETRY ?? { retries: 4, baseMs: 1, maxMs: 5 };
const SAFETY = { truncated: 3, ...common.SAFETY };
const failedToStart = (r: { reason: string; turns: number; calls: unknown[] }): boolean => (common as any).failedToStart?.(r) ?? false;
RETRY.baseMs = 1; RETRY.maxMs = 5; // keep the backoff short here

// ---- a scripted fetch ----
type Reply = (body: any, url: string) => Response | Promise<Response>;
interface Fake { calls: { url: string; body: any }[] }
function fake(replies: Reply[]): Fake {
  const f: Fake = { calls: [] };
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (init?.signal?.aborted) throw init.signal.reason ?? new DOMException('aborted', 'AbortError');
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    f.calls.push({ url, body });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request ${f.calls.length} to ${url}`);
    return next(structuredClone(body), url);
  }) as typeof fetch;
  return f;
}
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const sse = (events: { type: string }[]) =>
  new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });

// ---- Claude: a streamed message ----
type Block = { type: 'thinking'; text: string } | { type: 'text'; text: string } | { type: 'tool_use'; name: string; json: string };
function claude(blocks: Block[], stop: string, usage = { input: 100, output: 50 }): Reply {
  return () => {
    const ev: any[] = [{ type: 'message_start', message: { id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: usage.input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }];
    blocks.forEach((b, index) => {
      if (b.type === 'thinking') {
        ev.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } },
          { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.text } },
          { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } });
      } else if (b.type === 'text') {
        ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
      } else {
        ev.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_${index}`, name: b.name, input: {} } });
        for (let i = 0; i < b.json.length; i += 7) ev.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: b.json.slice(i, i + 7) } });
      }
      ev.push({ type: 'content_block_stop', index });
    });
    ev.push({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output } }, { type: 'message_stop' });
    return sse(ev);
  };
}
const FINISH: Block = { type: 'tool_use', name: 'finish', json: '{"summary":"done"}' };
const ADD = (id: string): Block => ({ type: 'tool_use', name: 'add_parts', json: JSON.stringify({ parts: [{ id }] }) });

// ---- OpenAI: a streamed Responses API response ----
function gpt(output: any[], status: 'completed' | 'incomplete' = 'completed', reason: string | null = null): Reply {
  return () => {
    const response = (s: string, out: any[]) => ({ id: 'resp_x', object: 'response', created_at: 0, model: 'gpt-test', status: s, output: out,
      incomplete_details: s === 'incomplete' ? { reason } : null, error: null, instructions: null, tools: [], parallel_tool_calls: true,
      usage: s === 'in_progress' ? null : { input_tokens: 100, output_tokens: 50, total_tokens: 150, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
    return sse([{ type: 'response.created', sequence_number: 0, response: response('in_progress', []) } as any,
      { type: `response.${status}`, sequence_number: 1, response: response(status, output) }]);
  };
}
const call = (name: string, args: string) => ({ type: 'function_call', id: `fc_${name}`, call_id: `call_${name}`, name, arguments: args, status: 'completed' });

// ---- chat completions ----
const chat = (message: any, finish = 'stop') => () => json({ choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
const chatFinish = chat({ content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'finish', arguments: '{"summary":"done"}' } }] }, 'tool_calls');
const provider = (id: string) => PROVIDERS.find(p => p.id === id)!;

// ---- a run with a recording executor ----
function lane(provider: AgentSpec['provider'], model: string, effort: Effort = '', maxOut: number | null = null) {
  const statuses: string[] = [], ran: string[] = [];
  const events: Events = { status: s => statuses.push(s), text() {}, thought() {}, call() {}, usage() {} };
  const run = new Run({ provider, model, label: model, key: 'test-key', price: null, vision: true, maxOut }, effort, 'system', async (name, input) => {
    ran.push(name);
    if (name === 'finish') return { text: 'Run finished.', finished: String((input as any)?.summary ?? '') };
    return { text: 'ok' };
  }, events);
  return { run, statuses, ran };
}
const T = { timeout: 30000 };

// ==== H1: a turn cut off by the output limit is not "Finished" ====
test('Claude: a turn cut off before any tool call continues, with a fixed note', T, async () => {
  const f = fake([claude([{ type: 'thinking', text: 'long plan' }], 'max_tokens'), claude([FINISH], 'tool_use')]);
  const { run } = lane('anthropic', 'claude-opus-5-5');
  await runClaude(run);
  assert.equal(run.reason, 'finished');
  assert.equal(f.calls.length, 2);
  const sent = f.calls[1].body.messages;
  assert.equal(sent[1].role, 'assistant'); // the cut-off turn goes back unchanged
  assert.match(JSON.stringify(sent[2]), /cut off by the output limit/);
});

test('Claude: three cut-off turns in a row end the run as truncated, not Finished', T, async () => {
  fake(Array.from({ length: SAFETY.truncated }, () => claude([{ type: 'thinking', text: 'plan' }], 'max_tokens')));
  const { run } = lane('anthropic', 'claude-opus-5-5');
  await runClaude(run);
  assert.equal(run.reason, 'truncated');
  assert.equal(run.turn, SAFETY.truncated);
  assert.ok(REASONS.truncated && REASONS.truncated !== REASONS.finished);
});

test('OpenAI: an incomplete response with no tool call continues', T, async () => {
  const f = fake([gpt([{ type: 'reasoning', id: 'rs_1', summary: [] }], 'incomplete', 'max_output_tokens'), gpt([call('finish', '{"summary":"done"}')])]);
  const { run } = lane('openai', 'gpt-6.1-sol');
  await runOpenAI(run);
  assert.equal(run.reason, 'finished');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].body.previous_response_id, 'resp_x');
  assert.match(JSON.stringify(f.calls[1].body.input), /cut off by the output limit/);
});

test('OpenAI: a response cut off by the content filter is declined, not Finished', T, async () => {
  fake([gpt([], 'incomplete', 'content_filter')]);
  const { run } = lane('openai', 'gpt-6.1-sol');
  await runOpenAI(run);
  assert.equal(run.reason, 'declined');
});

test('Chat: finish_reason length with no tool call continues', T, async () => {
  const f = fake([chat({ content: 'Planning the block…' }, 'length'), chatFinish]);
  const { run } = lane('deepseek', 'deepseek-chat');
  await runChat(run, provider('deepseek'));
  assert.equal(run.reason, 'finished');
  const sent = f.calls[1].body.messages;
  assert.equal(sent.at(-2).role, 'assistant');
  assert.match(sent.at(-1).content, /cut off by the output limit/);
});

test('Chat: a cut-off turn with no text joins the note to the last user message', T, async () => {
  const f = fake([chat({ content: null, reasoning_content: 'thinking' }, 'length'), chatFinish]);
  const { run } = lane('deepseek', 'deepseek-reasoner');
  await runChat(run, provider('deepseek'));
  assert.equal(run.reason, 'finished');
  const roles = f.calls[1].body.messages.map((m: any) => m.role);
  assert.deepEqual(roles, ['system', 'user']);
  assert.match(f.calls[1].body.messages[1].content, /^Build the engine\.\n\nYour last turn was cut off/);
});

// ==== H2: chat providers retry like the SDKs do ====
test('Chat: 503, 429 and a network failure are retried within one turn', T, async () => {
  const f = fake([() => json({ error: { message: 'overloaded' } }, 503), () => json({ error: { message: 'slow down' } }, 429, { 'retry-after': '0' }),
    () => { throw new TypeError('Failed to fetch'); }, chatFinish]);
  const { run, statuses } = lane('google', 'gemini-3.8-flash');
  await runChat(run, provider('google'));
  assert.equal(run.reason, 'finished');
  assert.equal(f.calls.length, 4);
  assert.equal(run.turn, 1);
  assert.ok(statuses.includes('Retrying'));
});

test('Chat: an error inside an HTTP 200 body is retried', T, async () => {
  const f = fake([() => json({ error: { message: 'Provider returned error', code: 502 } }), chatFinish]);
  const { run } = lane('openrouter', 'google/gemini-3.8-flash');
  await runChat(run, provider('openrouter'));
  assert.equal(run.reason, 'finished');
  assert.equal(f.calls.length, 2);
});

test('Chat: a 400 is not retried, and retries stop after four', T, async () => {
  let f = fake([() => json({ error: { message: 'bad request' } }, 400)]);
  let r = lane('groq', 'llama-x');
  await runChat(r.run, provider('groq'));
  assert.equal(r.run.reason, 'error');
  assert.equal(f.calls.length, 1);
  f = fake(Array.from({ length: RETRY.retries + 1 }, () => () => json({ error: { message: 'down' } }, 500)));
  r = lane('groq', 'llama-x');
  await runChat(r.run, provider('groq'));
  assert.equal(r.run.reason, 'error');
  assert.equal(f.calls.length, RETRY.retries + 1);
});

test('Chat: stopping during a backoff sends nothing more', T, async () => {
  RETRY.baseMs = 2000; RETRY.maxMs = 2000;
  try {
    const f = fake([() => json({ error: { message: 'down' } }, 503)]);
    const { run } = lane('mistral', 'mistral-large-latest');
    const done = runChat(run, provider('mistral'));
    setTimeout(() => run.stop('stopped'), 50);
    await done;
    assert.equal(run.reason, 'stopped');
    assert.equal(f.calls.length, 1);
  } finally { RETRY.baseMs = 1; RETRY.maxMs = 5; }
});

// ==== M1: only the cut-off Claude tool call is dropped ====
test('Claude: complete tool calls before the cut-off one still run', T, async () => {
  fake([claude([ADD('a'), ADD('b'), { type: 'tool_use', name: 'add_parts', json: '{"parts":[{"id":"c"' }], 'max_tokens'), claude([FINISH], 'tool_use')]);
  const { run, ran } = lane('anthropic', 'claude-opus-5-5');
  await runClaude(run);
  assert.deepEqual(ran, ['add_parts', 'add_parts', 'finish']);
  assert.deepEqual(run.calls.map(c => !!c.skipped), [false, false, true, false]);
});

test('Claude: with text after the last tool call, every tool call is whole and runs', T, async () => {
  fake([claude([ADD('a'), { type: 'text', text: 'and now the head' }], 'max_tokens'), claude([FINISH], 'tool_use')]);
  const { run, ran } = lane('anthropic', 'claude-opus-5-5');
  await runClaude(run);
  assert.deepEqual(ran, ['add_parts', 'finish']);
});

// ==== M2: a Claude turn that fails on malformed tool JSON still counts its tokens ====
test('Claude: a failed attempt\'s reported usage is counted before the retry', T, async () => {
  fake([claude([{ type: 'tool_use', name: 'add_parts', json: '{"parts":[1,,2]}' }], 'tool_use', { input: 1000, output: 10 }), claude([FINISH], 'tool_use', { input: 100, output: 50 })]);
  const { run } = lane('anthropic', 'claude-opus-5-5');
  await runClaude(run);
  assert.equal(run.reason, 'finished');
  assert.equal(run.usage.input, 1100);
});

test('Claude: a streamed tool input is parsed once, not again on every chunk', T, async () => {
  const parts = Array.from({ length: 40 }, (_, i) => ({ id: `part_${i}`, subsystem: 'block', shape: { type: 'box', size: [10, 10, 10] }, position: [i, 0, 0] }));
  fake([claude([{ type: 'tool_use', name: 'add_parts', json: JSON.stringify({ parts }) }], 'tool_use'), claude([FINISH], 'tool_use')]);
  const { run, statuses } = lane('anthropic', 'claude-opus-5-5');
  const parse = JSON.parse;
  let inputParses = 0; // the SDK's partial parser ends in JSON.parse of the repaired buffer
  JSON.parse = ((text: string, ...rest: any[]) => { if (typeof text === 'string' && text.startsWith('{"parts"')) inputParses++; return (parse as any)(text, ...rest); }) as typeof JSON.parse;
  try { await runClaude(run); } finally { JSON.parse = parse; }
  assert.equal(run.reason, 'finished');
  assert.ok(inputParses <= 2, `parsed ${inputParses} times`);
  assert.ok(statuses.includes('Building'));
});

// ==== M3: every chat provider gets the same output limit ====
test('Chat: the shared 32,000-token limit is sent even without a catalogue limit', T, async () => {
  const f = fake([chatFinish]);
  const { run } = lane('deepseek', 'deepseek-chat');
  await runChat(run, provider('deepseek'));
  assert.equal(f.calls[0].body.max_tokens, 32000);
});

test('Chat: a provider that refuses the limit gets the same turn again without it', T, async () => {
  const f = fake([() => json({ error: { message: 'Invalid max_tokens value, the valid range of max_tokens is [1, 8192]' } }, 400), chatFinish]);
  const { run } = lane('deepseek', 'deepseek-chat');
  await runChat(run, provider('deepseek'));
  assert.equal(run.reason, 'finished');
  assert.equal(run.turn, 1);
  assert.equal(f.calls[1].body.max_tokens, undefined);
});

// ==== M4: a lane that fails on its first turn voids the race ====
test('A first-turn error voids the race; a later one does not', () => {
  assert.equal(failedToStart({ reason: 'error', turns: 1, calls: [] }), true);
  assert.equal(failedToStart({ reason: 'error', turns: 3, calls: [{}] }), false);
  assert.equal(failedToStart({ reason: 'finished', turns: 1, calls: [] }), false);
  assert.ok(REASONS.void);
  const side = (tag: 'A' | 'B', score: number) => ({ tag, label: `Model ${tag}`, provider: 'x', score, parts: 1, ms: 1000, cost: null, tokensIn: 0, tokensOut: 0, reason: '', history: [], scores: [], spend: [] });
  const r = { sides: [side('A', 0), side('B', 46)], winner: null, voided: true, fingerprint: 'b131db1ab5db', ghost: null as any, end: 1000 } as Result;
  assert.match(postText(r), /Race void\./);
  assert.doesNotMatch(postText(r), /dead heat/);
});

test('OpenAI: a 400 for reasoning summaries retries the same turn without them', T, async () => {
  const f = fake([() => json({ error: { message: 'Your organization must be verified to generate reasoning summaries.', type: 'invalid_request_error', param: 'reasoning.summary', code: 'unsupported_value' } }, 400),
    gpt([call('finish', '{"summary":"done"}')])]);
  const { run } = lane('openai', 'gpt-6.1-sol');
  await runOpenAI(run);
  assert.equal(run.reason, 'finished');
  assert.equal(run.turn, 1);
  assert.equal(f.calls[0].body.reasoning.summary, 'auto');
  assert.equal(f.calls[1].body.reasoning?.summary, undefined);
});

// ==== M5: the effort actually sent is what the record keeps ====
test('Claude 4.6 models get high for Extra high; Opus 4.5 gets effort without adaptive thinking', T, async () => {
  let f = fake([claude([FINISH], 'tool_use')]);
  let r = lane('anthropic', 'claude-opus-4-6', 'xhigh');
  await runClaude(r.run);
  assert.equal(f.calls[0].body.output_config.effort, 'high');
  assert.equal(r.run.effort, 'high');
  f = fake([claude([FINISH], 'tool_use')]);
  r = lane('anthropic', 'claude-opus-4-5', 'medium');
  await runClaude(r.run);
  assert.equal(f.calls[0].body.output_config?.effort, 'medium');
  assert.equal(f.calls[0].body.thinking, undefined);
  f = fake([claude([FINISH], 'tool_use')]);
  r = lane('anthropic', 'claude-haiku-4-5', 'high');
  await runClaude(r.run);
  assert.equal(f.calls[0].body.output_config, undefined);
  assert.equal(r.run.effort, '');
});

test('A provider that is sent no effort records the model default', T, async () => {
  let f = fake([chatFinish]);
  let r = lane('deepseek', 'deepseek-chat', 'high');
  await runChat(r.run, provider('deepseek'));
  assert.equal(f.calls[0].body.reasoning_effort, undefined);
  assert.equal(r.run.effort, '');
  f = fake([chatFinish]);
  r = lane('google', 'gemini-3.8-flash', 'xhigh');
  await runChat(r.run, provider('google'));
  assert.equal(f.calls[0].body.reasoning_effort, 'high');
  assert.equal(r.run.effort, 'high');
  f = fake([gpt([call('finish', '{"summary":"done"}')])]);
  r = lane('openai', 'gpt-4.1', 'high');
  await runOpenAI(r.run);
  assert.equal(f.calls[0].body.reasoning, undefined);
  assert.equal(r.run.effort, '');
});

// ==== M6: no live region rewritten on every streamed token ====
test('The state label is passed on only when it changes', () => {
  const { run, statuses } = lane('mock', 'test-box');
  for (const s of ['Writing', 'Writing', 'Writing', 'Building', 'Writing', 'Writing']) run.on.status(s);
  run.finish('finished');
  assert.deepEqual(statuses, ['Writing', 'Building', 'Writing']);
});

test('The activity feeds are not live regions', async () => {
  const html = await readFile('site/bench/index.html', 'utf8');
  assert.equal((html.match(/<ol class="feed"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<ol class="feed"[^>]*aria-live/);
});

// ==== M7: building does not chain zero-delay timers ====
test('Adding parts yields without timers, which background tabs throttle', async () => {
  const ws = new Workspace(() => 0);
  const real = globalThis.setTimeout;
  let timers = 0;
  globalThis.setTimeout = ((fn: any, ms?: number, ...a: any[]) => { timers++; return real(fn, ms, ...a); }) as typeof setTimeout;
  try {
    const parts = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, subsystem: 'block', shape: { type: 'box', size: [10, 10, 10] }, position: [i * 20, 0, 0] }));
    const out = await ws.add({ parts });
    assert.match(out.text, /^Added 8 parts/);
  } finally { globalThis.setTimeout = real; ws.dispose(); }
  assert.equal(timers, 0);
});
