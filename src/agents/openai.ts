// OpenAI agent loop: official SDK and the Responses API, called straight from the visitor's browser.
import OpenAI from 'openai';
import { TOOLS } from '../tools';
import { KICKOFF, type Run } from './common';

// Reasoning models take the effort setting; older chat models reject it.
const REASONING = /^(gpt-[5-9]|o\d|codex)/;

function message(err: unknown): string {
  if (err instanceof OpenAI.AuthenticationError) return 'The OpenAI key was rejected.';
  if (err instanceof OpenAI.PermissionDeniedError) return 'This OpenAI key cannot use that model.';
  if (err instanceof OpenAI.NotFoundError) return 'That OpenAI model was not found for this key.';
  if (err instanceof OpenAI.RateLimitError) return 'OpenAI rate limit or quota reached. Try again later or lower the effort.';
  if (err instanceof OpenAI.APIConnectionError) return 'Could not reach the OpenAI API.';
  if (err instanceof OpenAI.APIError) return `OpenAI API error ${err.status ?? ''}: ${err.message}`;
  return (err as Error)?.message || String(err);
}

// Before the race: a free call that proves the key works and can use the model.
// (A rejected key on /v1/responses comes back without CORS headers, so the browser could not tell why.)
export async function checkOpenAI(key: string, model: string): Promise<string | null> {
  try {
    await new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 15000 }).models.retrieve(model);
    return null;
  } catch (err) { return message(err); }
}

export async function runOpenAI(run: Run): Promise<void> {
  const client = new OpenAI({ apiKey: run.spec.key, dangerouslyAllowBrowser: true, maxRetries: 4 });
  const tools: OpenAI.Responses.FunctionTool[] = TOOLS.map(t => ({
    type: 'function', name: t.name, description: t.description, parameters: t.input_schema, strict: false,
  }));
  const reasoning = REASONING.test(run.spec.model);
  let input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: KICKOFF }];
  let previous: string | undefined;

  try {
    for (;;) {
      const limit = run.limit();
      if (limit) return run.finish(limit);
      run.turn++;
      run.on.status('Thinking');
      const stream = client.responses.stream({
        model: run.spec.model,
        instructions: run.system,
        input,
        tools,
        previous_response_id: previous,
        max_output_tokens: 32000,
        parallel_tool_calls: true,
        store: true,
        ...(reasoning ? { reasoning: { ...(run.effort ? { effort: run.effort } : {}), summary: 'auto' as const } } : {}),
      }, { signal: run.signal });
      stream.on('response.output_text.delta', e => { run.on.status('Writing'); run.on.text(e.delta); });
      stream.on('response.reasoning_summary_text.delta', e => run.on.thought(e.delta));
      stream.on('response.function_call_arguments.delta', () => run.on.status('Building'));

      const resp = await stream.finalResponse();
      previous = resp.id;
      const u = resp.usage;
      if (u) {
        const cached = u.input_tokens_details?.cached_tokens ?? 0;
        run.add({ input: u.input_tokens - cached, cacheRead: cached, output: u.output_tokens });
      }
      const refused = resp.output.some(o => o.type === 'message' && o.content.some(c => c.type === 'refusal'));
      if (refused) return run.finish('declined');
      const calls: { name: string; call_id: string; arguments: string }[] = [];
      for (const o of resp.output) if (o.type === 'function_call') calls.push(o);
      if (!calls.length) return run.finish('ended');

      input = [];
      let finished: string | undefined;
      for (const call of calls) {
        let args: unknown;
        try { args = JSON.parse(call.arguments); }
        catch {
          run.skip(call.name, null);
          input.push({ type: 'function_call_output', call_id: call.call_id, output: resp.status === 'incomplete'
            ? 'This call was cut off by the output limit for one turn and was not run. Send fewer parts per call.'
            : 'The arguments were not valid JSON, so this call was not run.' });
          continue;
        }
        run.on.status(call.name === 'render_view' || call.name === 'get_reference' ? 'Looking' : 'Building');
        const out = await run.tool(call.name, args);
        if (out.finished !== undefined) finished = out.finished;
        input.push({
          type: 'function_call_output', call_id: call.call_id,
          output: out.image
            ? [{ type: 'input_text', text: out.text }, { type: 'input_image', image_url: `data:image/png;base64,${out.image}`, detail: 'high' }]
            : out.text,
        });
      }
      if (finished !== undefined) return run.finish('finished', { summary: finished });
    }
  } catch (err) {
    if (run.signal.aborted) return run.finish(run.reason || 'stopped');
    run.finish('error', { error: message(err) });
  }
}
