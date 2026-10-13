// Agent loop for every provider with an OpenAI-style chat completions API: OpenRouter, Google,
// xAI, Mistral, DeepSeek, Groq and the rest. Plain fetch from the visitor's browser with their key.
// Each assistant message goes back exactly as the provider sent it, so provider-specific fields
// (reasoning details, thought signatures) survive from turn to turn.
import { TOOLS } from '../tools';
import type { ProviderInfo } from '../providers';
import { KICKOFF, MAX_OUT, TRUNCATED, type Run } from './common';

type Msg = Record<string, unknown> & { role: string };
interface ToolCall { id: string; type?: string; function: { name: string; arguments: string } }

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function headers(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
}

async function failure(res: Response): Promise<HttpError> {
  let text = '';
  try { const j = await res.json(); text = j?.error?.message ?? j?.message ?? j?.detail ?? JSON.stringify(j); } catch { /* not JSON */ }
  return new HttpError(res.status, String(text).slice(0, 300));
}

function message(p: ProviderInfo, err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return `The ${p.label.split(' (')[0]} key was rejected.`;
    if (err.status === 404) return `That model was not found at ${p.label.split(' (')[0]}.`;
    if (err.status === 402) return `The ${p.label.split(' (')[0]} account is out of credit.`;
    if (err.status === 429) return `${p.label.split(' (')[0]} rate limit reached. Try again in a minute.`;
    return `${p.label.split(' (')[0]} error ${err.status}: ${err.message}`;
  }
  if (err instanceof TypeError) return `Could not reach ${p.label.split(' (')[0]}.`;
  return (err as Error)?.message || String(err);
}

// Before the race: proves the key works, where the provider can say so from a browser.
export async function checkChat(p: ProviderInfo, key: string): Promise<string | null> {
  const url = p.id === 'openrouter' ? `${p.base}/key` : `${p.base}/models`;
  try {
    const res = await fetch(url, { headers: headers(key), signal: AbortSignal.timeout(12000) });
    if (res.ok) return null;
    const err = await failure(res);
    // Some providers answer a bad key with 400 ("API key not valid") instead of 401.
    if (res.status === 401 || res.status === 403 || /api[ _-]?key|unauthori[sz]ed|authenticat/i.test(err.message)) return message(p, new HttpError(401, ''));
    return null;
  } catch { return null; } // unreachable or slow from a browser; the race itself will still report a bad key
}

// Model IDs the key can use, for the model picker. Empty when the provider will not list them.
export async function listChatModels(p: ProviderInfo, key: string): Promise<string[]> {
  try {
    const res = await fetch(`${p.base}/models`, { headers: headers(key), signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const j = await res.json();
    const rows: { id?: string; name?: string }[] = Array.isArray(j) ? j : j.data ?? j.models ?? [];
    return rows.map(r => String(r.id ?? r.name ?? '').replace(/^models\//, '')).filter(Boolean).sort();
  } catch { return []; }
}

const IMAGE_REFUSAL = /image|vision|multimodal|modalit/i;
const LIMIT_REFUSAL = /max_(completion_)?tokens|maximum.*tokens|output.*limit|context (length|window)/i;

// The same retry policy the Anthropic and OpenAI SDKs apply: up to four retries with exponential backoff
// (honoring retry-after when the provider exposes it) for timeouts, conflicts, rate limits, server errors,
// network failures and an error reported inside a 200 response. A retry is not a new turn.
export const RETRY = { retries: 4, baseMs: 500, maxMs: 8000 };
const retryable = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

function backoff(attempt: number, res?: Response): number {
  const ms = Number(res?.headers.get('retry-after-ms'));
  if (ms > 0 && ms <= 60_000) return ms;
  const after = res?.headers.get('retry-after');
  if (after) {
    const s = Number(after), at = Date.parse(after) - Date.now();
    if (after.trim() !== '' && s >= 0 && s <= 60) return s * 1000;
    if (at > 0 && at <= 60_000) return at;
  }
  return Math.min(RETRY.maxMs, RETRY.baseMs * 2 ** attempt) * (1 - Math.random() * 0.25);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((ok, no) => {
    if (signal.aborted) return no(signal.reason);
    const t = setTimeout(() => { signal.removeEventListener('abort', stop); ok(); }, ms);
    const stop = () => { clearTimeout(t); no(signal.reason); };
    signal.addEventListener('abort', stop, { once: true });
  });
}

// An error a provider (OpenRouter, for one) reports inside an HTTP 200 body, with its status when it gives one.
function bodyError(data: any): HttpError | null {
  if (!data || typeof data !== 'object' || data.choices?.length || !data.error) return null;
  const code = Number(data.error.code ?? data.error.status);
  return new HttpError(Number.isInteger(code) && code >= 400 && code < 600 ? code : 502, String(data.error.message ?? 'The provider returned an error.').slice(0, 300));
}

export async function runChat(run: Run, p: ProviderInfo): Promise<void> {
  const tools = TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const messages: Msg[] = [{ role: 'system', content: run.system }, { role: 'user', content: KICKOFF }];
  let vision = run.spec.vision !== false;
  let capped = true; // send the shared output limit unless the provider refuses it
  if (!(run.effort && p.effort)) run.effort = '';
  else if (run.effort === 'xhigh') run.effort = 'high';

  const body = () => ({
    model: run.spec.model, messages, tools, tool_choice: 'auto',
    ...(capped ? { max_tokens: Math.min(MAX_OUT, run.spec.maxOut ?? MAX_OUT) } : {}),
    ...(run.effort && p.effort === 'openrouter' ? { reasoning: { effort: run.effort } } : {}),
    ...(run.effort && p.effort === 'reasoning_effort' ? { reasoning_effort: run.effort } : {}),
    ...(p.id === 'openrouter' ? { usage: { include: true } } : {}),
  });

  // Drops every image already in the conversation, for a model that turns out not to read images.
  const stripImages = () => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].images) messages.splice(i, 1);
  };

  // A note from the page as a user message; joined to the last one if that is a user message too, since some
  // providers refuse two user messages in a row.
  const note = (text: string) => {
    const last = messages[messages.length - 1];
    if (last.role !== 'user') messages.push({ role: 'user', content: text });
    else if (typeof last.content === 'string') last.content = `${last.content}\n\n${text}`;
    else if (Array.isArray(last.content)) last.content.push({ type: 'text', text });
  };

  // One model call, retried like the SDKs retry theirs.
  const request = async (): Promise<any> => {
    for (let attempt = 0; ; attempt++) {
      let res: Response | undefined, err: Error;
      try {
        res = await fetch(`${p.base}/chat/completions`, { method: 'POST', headers: headers(run.spec.key), body: JSON.stringify(body(), (k, v) => k === 'images' ? undefined : v), signal: run.signal });
        if (res.ok) {
          const data = await res.json();
          const inBody = bodyError(data);
          if (!inBody) return data;
          err = inBody;
        } else err = await failure(res);
      } catch (e) {
        if (run.signal.aborted || !(e instanceof TypeError)) throw e;
        err = e; // the network failed
      }
      const status = err instanceof HttpError ? err.status : 0;
      if ((status && !retryable(status)) || attempt >= RETRY.retries) throw err;
      run.on.status('Retrying');
      await wait(backoff(attempt, res), run.signal);
    }
  };

  try {
    for (;;) {
      const limit = run.limit();
      if (limit) return run.finish(limit);
      run.turn++;
      run.on.status('Thinking');
      let data: any;
      try { data = await request(); }
      catch (err) {
        if (err instanceof HttpError && err.status === 400 && vision && IMAGE_REFUSAL.test(err.message) && messages.some(m => m.images)) {
          vision = false; stripImages(); run.turn--;
          run.on.thought('This model cannot read images, so renders will be described in text only. ');
          continue;
        }
        if (err instanceof HttpError && err.status === 400 && capped && LIMIT_REFUSAL.test(err.message)) {
          capped = false; run.turn--;
          run.on.thought(`This provider refused a ${MAX_OUT.toLocaleString('en-US')}-token limit per turn, so its own default applies. `);
          continue;
        }
        throw err;
      }
      const u = data.usage ?? {};
      const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
      run.add({ input: (u.prompt_tokens ?? 0) - cached, cacheRead: cached, output: u.completion_tokens ?? 0 }, u.cost);
      const choice = data.choices?.[0];
      const msg: Msg | undefined = choice?.message;
      if (!msg) throw new Error(data.error?.message ?? 'The provider sent no message.');
      const reasoning = msg.reasoning ?? msg.reasoning_content;
      if (typeof reasoning === 'string' && reasoning) run.on.thought(reasoning.slice(-1200));
      const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((c: { text?: string }) => c.text ?? '').join('') : '';
      if (text) { run.on.status('Writing'); run.on.text(text); }
      if (msg.refusal) return run.finish('declined');

      const kept: Msg = { role: 'assistant' };
      for (const [k, v] of Object.entries(msg)) if (v !== null && v !== undefined) kept[k] = v;
      const calls = (msg.tool_calls as ToolCall[] | undefined) ?? [];
      if (!calls.length) {
        if (choice.finish_reason === 'content_filter') return run.finish('declined');
        if (choice.finish_reason !== 'length') return run.finish('ended');
        // Cut off by the output limit before any tool call: not an end. Say so and let the model go on.
        if (!run.truncated()) return;
        if (text) messages.push(kept);
        note(TRUNCATED);
        continue;
      }
      run.progressed();
      messages.push(kept);

      const images: string[] = [];
      let finished: string | undefined;
      for (const call of calls) {
        let args: unknown;
        try { args = JSON.parse(call.function.arguments || '{}'); }
        catch {
          run.skip(call.function.name, null);
          messages.push({ role: 'tool', tool_call_id: call.id, content: choice.finish_reason === 'length'
            ? 'This call was cut off by the output limit for one turn and was not run. Send fewer parts per call.'
            : 'The arguments were not valid JSON, so this call was not run.' });
          continue;
        }
        run.on.status(call.function.name === 'render_view' || call.function.name === 'get_reference' ? 'Looking' : 'Building');
        const out = await run.tool(call.function.name, args);
        if (out.finished !== undefined) finished = out.finished;
        let content = out.text;
        if (out.image) {
          if (vision) { images.push(out.image); content += '\n(The image follows in the next message.)'; }
          else content += '\n(This model cannot read images, so the picture was not sent.)';
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content });
      }
      if (finished !== undefined) return run.finish('finished', { summary: finished });
      if (images.length) messages.push({
        role: 'user', images: true,
        content: [{ type: 'text', text: `The ${images.length === 1 ? 'image' : `${images.length} images`} from your last tool calls, in order.` },
          ...images.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }))],
      });
    }
  } catch (err) {
    if (run.signal.aborted) return run.finish(run.reason || 'stopped');
    run.finish('error', { error: message(p, err) });
  }
}
