// Every provider a visitor can bring a key for. All of these accept calls straight from a
// browser (checked 5 Oct 2026: CORS on the preflight and on error responses). Each origin is
// also listed in the page's connect-src, so the page can talk to nothing else.
export type Provider = 'openrouter' | 'anthropic' | 'openai' | 'google' | 'xai' | 'mistral' | 'deepseek' | 'groq'
  | 'together' | 'fireworks' | 'cerebras' | 'moonshot' | 'qwen' | 'cohere' | 'huggingface' | 'mock';

export interface ProviderInfo {
  id: Provider;
  label: string;
  kind: 'chat' | 'anthropic' | 'openai' | 'mock'; // chat = OpenAI-style chat completions
  base?: string;                // chat completions base URL
  keyHint?: string;
  keyUrl?: string;
  effort?: 'openrouter' | 'reasoning_effort'; // how the effort setting is passed, if at all
  model?: string;               // suggested model ID
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openrouter', label: 'OpenRouter (hundreds of models, one key)', kind: 'chat', base: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys', effort: 'openrouter', model: 'google/gemini-3.8-flash' },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys', model: 'claude-opus-5-5' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys', model: 'gpt-6.1-sol' },
  { id: 'google', label: 'Google Gemini', kind: 'chat', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey', effort: 'reasoning_effort', model: 'gemini-3.8-flash' },
  { id: 'xai', label: 'xAI', kind: 'chat', base: 'https://api.x.ai/v1', keyHint: 'xai-…', keyUrl: 'https://console.x.ai', model: 'grok-4.7' },
  { id: 'mistral', label: 'Mistral', kind: 'chat', base: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'chat', base: 'https://api.deepseek.com', keyHint: 'sk-…', keyUrl: 'https://platform.deepseek.com' },
  { id: 'groq', label: 'Groq', kind: 'chat', base: 'https://api.groq.com/openai/v1', keyHint: 'gsk_…', keyUrl: 'https://console.groq.com/keys' },
  { id: 'together', label: 'Together AI', kind: 'chat', base: 'https://api.together.xyz/v1' },
  { id: 'fireworks', label: 'Fireworks', kind: 'chat', base: 'https://api.fireworks.ai/inference/v1', keyHint: 'fw_…' },
  { id: 'cerebras', label: 'Cerebras', kind: 'chat', base: 'https://api.cerebras.ai/v1', keyHint: 'csk-…' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', kind: 'chat', base: 'https://api.moonshot.ai/v1', keyHint: 'sk-…' },
  { id: 'qwen', label: 'Alibaba Cloud (Qwen)', kind: 'chat', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyHint: 'sk-…' },
  { id: 'cohere', label: 'Cohere', kind: 'chat', base: 'https://api.cohere.ai/compatibility/v1' },
  { id: 'huggingface', label: 'Hugging Face', kind: 'chat', base: 'https://router.huggingface.co/v1', keyHint: 'hf_…', keyUrl: 'https://huggingface.co/settings/tokens' },
];
export const MOCK: ProviderInfo = { id: 'mock', label: 'Test script (no model)', kind: 'mock' };

// Hosts for the page's Content-Security-Policy connect-src. Keep in step with PROVIDERS.
export const CONNECT_HOSTS = ['https://api.anthropic.com', 'https://api.openai.com', ...PROVIDERS.filter(p => p.base).map(p => new URL(p.base!).origin)];
