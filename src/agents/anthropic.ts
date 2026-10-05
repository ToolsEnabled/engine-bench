// Claude agent loop: official SDK, called straight from the visitor's browser with their own key.
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS } from '../tools';
import { KICKOFF, type Run } from './common';

// Older Claude models take neither adaptive thinking nor the effort setting.
const LEGACY = /claude-(3|haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0)/;

function message(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic key was rejected.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This Anthropic key cannot use that model.';
  if (err instanceof Anthropic.NotFoundError) return 'That Claude model was not found for this key.';
  if (err instanceof Anthropic.RateLimitError) return 'Anthropic rate limit reached. Try again later or lower the effort.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API.';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  return (err as Error)?.message || String(err);
}

// Before the race: a free call that proves the key works and can use the model.
export async function checkClaude(key: string, model: string): Promise<string | null> {
  try {
    await new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 15000 }).models.retrieve(model);
    return null;
  } catch (err) { return message(err); }
}

export async function runClaude(run: Run): Promise<void> {
  const client = new Anthropic({ apiKey: run.spec.key, dangerouslyAllowBrowser: true, maxRetries: 4 });
  const tools: Anthropic.Tool[] = TOOLS.map(t => ({
    name: t.name, description: t.description, eager_input_streaming: true,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
  const legacy = LEGACY.test(run.spec.model);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: KICKOFF }];
  let badJson = 0;

  try {
    for (;;) {
      const limit = run.limit();
      if (limit) return run.finish(limit);
      run.turn++;
      run.on.status('Thinking');
      const stream = client.messages.stream({
        model: run.spec.model,
        max_tokens: 32000,
        system: run.system,
        tools,
        messages,
        cache_control: { type: 'ephemeral' },
        ...(legacy ? {} : { thinking: { type: 'adaptive', display: 'summarized' } }),
        ...(!legacy && run.effort ? { output_config: { effort: run.effort } } : {}),
      }, { signal: run.signal });
      stream.on('text', d => { run.on.status('Writing'); run.on.text(d); });
      stream.on('thinking', d => run.on.thought(d));
      stream.on('inputJson', () => run.on.status('Building'));

      let msg: Anthropic.Message;
      try {
        msg = await stream.finalMessage();
        badJson = 0;
      } catch (err) {
        // Only a tool input that could not be parsed at all is retried; API errors go up.
        if (err instanceof Anthropic.APIError || run.signal.aborted || badJson++ >= 2) throw err;
        continue;
      }
      const u = msg.usage;
      run.add({ input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 });

      if (msg.stop_reason === 'refusal') return run.finish('declined');
      messages.push({ role: 'assistant', content: msg.content });
      if (msg.stop_reason === 'pause_turn') continue;
      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!uses.length) return run.finish('ended');

      const results: Anthropic.ToolResultBlockParam[] = [];
      let finished: string | undefined;
      for (const use of uses) {
        if (msg.stop_reason === 'max_tokens') {
          run.skip(use.name, use.input);
          // A tool input cut off by the per-turn output limit is never run.
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'This call was cut off by the output limit for one turn and was not run. Send fewer parts per call.' });
          continue;
        }
        run.on.status(use.name === 'render_view' || use.name === 'get_reference' ? 'Looking' : 'Building');
        const out = await run.tool(use.name, use.input);
        if (out.finished !== undefined) finished = out.finished;
        results.push({
          type: 'tool_result', tool_use_id: use.id, is_error: out.isError || undefined,
          content: out.image
            ? [{ type: 'text', text: out.text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: out.image } }]
            : out.text,
        });
      }
      messages.push({ role: 'user', content: results });
      if (finished !== undefined) return run.finish('finished', { summary: finished });
    }
  } catch (err) {
    if (run.signal.aborted) return run.finish(run.reason || 'stopped');
    run.finish('error', { error: message(err) });
  }
}
