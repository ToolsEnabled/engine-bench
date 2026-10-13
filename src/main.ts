// Engine Bench page: setup, the race, the live views, the result and the exports.
import * as THREE from 'three';
import { Goal } from './goal';
import { Studio, REF_BOX, VIEW_DIRS, type View } from './studio';
import { Viewport } from './viewport';
import { Workspace } from './workspace';
import { score, type Score } from './score';
import { systemPrompt } from './specs';
import { TOOLS, LIMITS } from './tools';
import { PROVIDERS, MOCK, type Provider, type ProviderInfo } from './providers';
import { Run, REASONS, failedToStart, type AgentSpec, type Effort, type Price, type ToolOutcome } from './agents/common';
import { drawCard, drawGrid, drawLeaderboard, recordClip, postText, clock, money, type Result, type Side } from './share';
import { BENCH_VERSION } from './version';
import { fingerprint, record, readRecords, replay, type RunRecord, type RecordFile } from './records';
import { loadLeaderboard, leaderboardTable, models, recordPath, type Entry } from './leaderboard';

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll(s)] as T[];
const DEV = new URLSearchParams(location.search).get('dev') === 'mock';
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage off */ } },
};
const ALL: ProviderInfo[] = DEV ? [MOCK, ...PROVIDERS] : PROVIDERS;
const info = (p: Provider) => ALL.find(x => x.id === p)!;
const short = (p: string) => ([MOCK, ...PROVIDERS].find(x => x.id === p)?.label ?? p).split(' (')[0];
$$('[data-bench]').forEach(e => { e.textContent = `Engine Bench ${BENCH_VERSION}`; });

// ---- what we know about models: list prices (USD per million tokens), images, output limit ----
interface ModelInfo { id: string; label: string; price: Price | null; vision: boolean | null; maxOut: number | null }
const KNOWN: Partial<Record<Provider, ModelInfo[]>> = {
  anthropic: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', price: { input: 4, output: 20, cacheRead: .2, cacheWrite: 5 }, vision: true, maxOut: 32000 },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', price: { input: 2, output: 10, cacheRead: .2, cacheWrite: 2.5 }, vision: true, maxOut: 32000 },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', price: { input: 10, output: 50, cacheRead: .25, cacheWrite: 12.5 }, vision: true, maxOut: 32000 },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', price: { input: 1, output: 5, cacheRead: .1, cacheWrite: 1.25 }, vision: true, maxOut: 32000 },
  ],
  openai: [
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', price: { input: 2, output: 10, cacheRead: .1, cacheWrite: 0 }, vision: true, maxOut: 32000 },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', price: { input: 10, output: 50, cacheRead: 1, cacheWrite: 0 }, vision: true, maxOut: 32000 },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', price: { input: 4, output: 20, cacheRead: .4, cacheWrite: 0 }, vision: true, maxOut: 32000 },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', price: { input: 1.75, output: 14, cacheRead: .175, cacheWrite: 0 }, vision: true, maxOut: 32000 },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', price: { input: .1, output: .5, cacheRead: .01, cacheWrite: 0 }, vision: true, maxOut: 32000 },
  ],
  mock: [
    { id: 'test-full', label: 'Baseline script: full spec', price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, vision: true, maxOut: null },
    { id: 'test-half', label: 'Baseline script: half', price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, vision: true, maxOut: null },
    { id: 'test-box', label: 'Baseline: one bounding box', price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, vision: true, maxOut: null },
  ],
};
const DEFAULTS: Record<'A' | 'B', [Provider | '', string]> = DEV
  ? { A: ['mock', 'test-full'], B: ['mock', 'test-half'] }
  : { A: ['', ''], B: ['', ''] };

// OpenRouter publishes its whole catalogue with prices; no key needed to read it.
let openrouter: Promise<ModelInfo[]> | null = null;
function openrouterModels(): Promise<ModelInfo[]> {
  openrouter ??= fetch('https://openrouter.ai/api/v1/models').then(r => r.json()).then(j => (j.data as Record<string, any>[])
    .filter(m => (m.supported_parameters ?? []).includes('tools') && !String(m.id).includes(':') && !String(m.id).startsWith('~') && +m.pricing?.prompt >= 0 && +m.pricing?.completion >= 0)
    .sort((a, b) => b.created - a.created)
    .map(m => ({
      id: m.id, label: String(m.name ?? m.id).replace(/^[^:]+:\s*/, ''),
      price: { input: +m.pricing.prompt * 1e6, output: +m.pricing.completion * 1e6, cacheRead: +(m.pricing.input_cache_read ?? m.pricing.prompt) * 1e6, cacheWrite: +(m.pricing.input_cache_write ?? m.pricing.prompt) * 1e6 },
      vision: (m.architecture?.input_modalities ?? []).includes('image'),
      maxOut: Math.min(32000, m.top_provider?.max_completion_tokens || 32000),
    }))).catch(() => { openrouter = null; return []; });
  return openrouter;
}
const listed = new Map<Provider, ModelInfo[]>(); // models a key could list, for providers without a public catalogue

async function modelsFor(p: Provider): Promise<ModelInfo[]> {
  if (p === 'openrouter') return openrouterModels();
  return KNOWN[p] ?? listed.get(p) ?? [];
}
async function modelInfo(p: Provider, id: string): Promise<ModelInfo | undefined> {
  return (await modelsFor(p)).find(m => m.id === id);
}

// ---- theme ----
const isDark = () => document.documentElement.dataset.theme !== 'light';
const views: Viewport[] = [];
function setTheme(t: 'dark' | 'light', save = true) {
  document.documentElement.dataset.theme = t;
  if (save) store.set('te-theme', t);
  $$('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
  $('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f6f6f7' : '#09090a');
  views.forEach(v => {
    v.setTheme(t === 'dark');
    v.under.traverse(o => { if (o instanceof THREE.Mesh) o.material = t === 'dark' ? ghostDark : ghostLight; });
    v.draw();
  });
}
$$('[data-theme-set]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeSet as 'dark' | 'light')));
setTheme(isDark() ? 'dark' : 'light', false);
const bar = $('#top');
addEventListener('scroll', () => bar.classList.toggle('scrolled', scrollY > 24), { passive: true });

// ---- the goal engine ----
const studio = new Studio();
let goal: Goal | null = null;
let refMasks: Float32Array[] = [];
const refRenders = new Map<string, string>();
let studioGhost: THREE.Group | null = null;
const ghostDark = new THREE.MeshLambertMaterial({ color: 0x5e121b, emissive: 0x22050a, side: THREE.DoubleSide });
const ghostLight = new THREE.MeshLambertMaterial({ color: 0xf3c3c8, emissive: 0x2a0a0d, side: THREE.DoubleSide });
const ghostMaterial = () => isDark() ? ghostDark : ghostLight;

const hero = new Viewport($<HTMLCanvasElement>('#goal-canvas'), { autoRotate: true });
views.push(hero);
hero.setTheme(isDark());
hero.start();

let reference: (view: View, section: boolean) => string = () => '';
const goalReady = (async () => {
  const label = $('#goal-loading span');
  try {
    goal = await Goal.load('/static/bench/goal', f => { label.textContent = `${Math.round(f * 100)}%`; });
  } catch (e) {
    $('#goal-loading').textContent = 'The goal engine did not load. Reload the page to try again.';
    throw e;
  }
  hero.content.add(goal.build());
  $('#goal-loading').remove();
  const refGroup = goal.build();
  refMasks = studio.depthMaps([refGroup]);
  studioGhost = goal.build(new THREE.MeshLambertMaterial({ color: 0x2c0a0f, emissive: 0x100306, side: THREE.DoubleSide }));
  if (DEV) {
    const self = score(goal.views(refGroup), studio.depthMaps([refGroup]), refMasks);
    console.info('goal self-score', self.total.toFixed(1), self);
  }
  reference = (view: View, section: boolean) => {
    const k = `${view}:${section}`;
    let png = refRenders.get(k);
    if (!png) { png = studio.png([refGroup], view, section, REF_BOX); refRenders.set(k, png); }
    return png;
  };
})();

// ---- the prompt: one fixed text for every race ----
const effort = () => $<HTMLSelectElement>('#effort').value as Effort;
const system = () => systemPrompt({ parts: LIMITS.parts, perCall: LIMITS.perCall });
let print = '';
const promptReady = fingerprint().then(value => {
  print = value;
  $('#fp').textContent = print;
});
$('#prompt-text').textContent = system();
$('#tools-text').textContent = JSON.stringify(TOOLS, null, 2);

// ---- setup form ----
const agentForm = (tag: 'A' | 'B') => $(`.agent-card[data-agent="${tag}"]`);
const providerOf = (tag: 'A' | 'B') => $<HTMLSelectElement>('[name=provider]', agentForm(tag)).value as Provider;
const keys = new Map<Provider, string>();
const remember = $<HTMLInputElement>('#remember');
try { const saved = JSON.parse(store.get('te-bench-keys') ?? 'null'); if (saved) { for (const [p, k] of Object.entries(saved)) if (typeof k === 'string' && k) keys.set(p as Provider, k); remember.checked = true; } } catch { store.set('te-bench-keys', null); }
function saveKeys() {
  store.set('te-bench-keys', remember.checked ? JSON.stringify(Object.fromEntries([...keys].filter(([, k]) => k))) : null);
}
remember.addEventListener('change', saveKeys);
$('#forget').addEventListener('click', () => { keys.clear(); remember.checked = false; saveKeys(); renderKeys(); });

async function fillList(tag: 'A' | 'B') {
  const p = providerOf(tag), list = $<HTMLDataListElement>(`#models-${tag}`);
  const models = await modelsFor(p);
  if (p !== providerOf(tag)) return;
  list.replaceChildren(...models.slice(0, 400).map(m => new Option(m.label, m.id)));
}
async function syncModel(tag: 'A' | 'B') {
  const f = agentForm(tag), p = providerOf(tag), id = $<HTMLInputElement>('[name=model]', f).value.trim();
  const m = id ? await modelInfo(p, id) : undefined;
  const k = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
  if (m?.price) k.forEach(n => { $<HTMLInputElement>(`[name=${n}]`, f).value = String(+m.price![n].toFixed(4)); });
  else if (m) k.forEach(n => { $<HTMLInputElement>(`[name=${n}]`, f).value = ''; });
  const priced = k.slice(0, 3).every(n => $<HTMLInputElement>(`[name=${n}]`, f).value !== '');
  $('.price summary span', f).textContent = p === 'openrouter' ? 'provider charge, when reported'
    : priced ? `$${$<HTMLInputElement>('[name=input]', f).value} in · $${$<HTMLInputElement>('[name=output]', f).value} out per million tokens` : 'add prices to show cost';
  $('.model-note', f).textContent = !id ? '' : m ? `${m.label}${m.vision === false ? ' · cannot read images' : ''}` : 'Not in the list. Check the ID with your provider.';
}
function renderKeys() {
  const used = [...new Set((['A', 'B'] as const).map(providerOf))].filter(p => p && p !== 'mock');
  const box = $('#key-fields');
  box.replaceChildren(...used.map(p => {
    const i = info(p), label = document.createElement('label');
    label.dataset.key = p;
    label.append(`${short(p)} API key`);
    const input = Object.assign(document.createElement('input'), { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: i.keyHint ?? 'Paste your key', value: keys.get(p) ?? '' });
    input.addEventListener('input', () => { keys.set(p, input.value.trim()); saveKeys(); });
    input.addEventListener('change', () => discover(p));
    label.append(input);
    if (i.keyUrl) { const a = Object.assign(document.createElement('a'), { href: i.keyUrl, target: '_blank', rel: 'noopener', textContent: 'Get a key' }); a.className = 'key-link'; label.append(a); }
    return label;
  }));
  $('#one-key').hidden = used.length !== 1;
}
// For providers without a public catalogue, ask the key which models it can use.
async function discover(p: Provider) {
  if (!p) return;
  const i = info(p), key = keys.get(p);
  if (i.kind !== 'chat' || p === 'openrouter' || !key) return;
  const ids = await (await import('./agents/chat')).listChatModels(i, key);
  if (ids.length) listed.set(p, ids.map(id => ({ id, label: id, price: null, vision: null, maxOut: null })));
  (['A', 'B'] as const).filter(t => providerOf(t) === p).forEach(t => { void fillList(t); void syncModel(t); });
}
for (const tag of ['A', 'B'] as const) {
  const f = agentForm(tag), ps = $<HTMLSelectElement>('[name=provider]', f), model = $<HTMLInputElement>('[name=model]', f);
  ps.add(new Option('Choose a provider', ''));
  for (const p of ALL) ps.add(new Option(p.label, p.id));
  [ps.value, model.value] = DEFAULTS[tag];
  ps.addEventListener('change', () => {
    model.value = '';
    $$<HTMLInputElement>('.price-grid input', f).forEach(i => { i.value = ''; });
    renderKeys(); void fillList(tag); void syncModel(tag); void discover(providerOf(tag));
  });
  model.addEventListener('change', () => void syncModel(tag));
  $$<HTMLInputElement>('.price-grid input', f).forEach(i => i.addEventListener('change', () => void syncModel(tag)));
  void fillList(tag).then(() => syncModel(tag));
}
renderKeys();

async function readAgent(tag: 'A' | 'B'): Promise<AgentSpec | string> {
  const f = agentForm(tag), provider = providerOf(tag);
  if (!provider) return `Agent ${tag}: choose a provider.`;
  const model = $<HTMLInputElement>('[name=model]', f).value.trim();
  if (!/^[\w.:/@+-]{2,120}$/.test(model)) return `Agent ${tag}: pick or type a model ID.`;
  const key = provider === 'mock' ? 'test' : keys.get(provider) ?? '';
  if (!key) return `Add your ${short(provider)} API key.`;
  const m = await modelInfo(provider, model);
  const nums = (['input', 'output', 'cacheRead', 'cacheWrite'] as const).map(k => $<HTMLInputElement>(`[name=${k}]`, f).value.trim());
  const price = nums.slice(0, 3).every(v => v !== '' && Number.isFinite(+v) && +v >= 0)
    ? { input: +nums[0], output: +nums[1], cacheRead: +nums[2], cacheWrite: nums[3] === '' ? +nums[0] : +nums[3] } : null;
  return { provider, model, label: m?.label ?? model, key, price, vision: m?.vision ?? null, maxOut: m?.maxOut ?? null };
}

// ---- the race ----
interface Lane { tag: 'A' | 'B'; pane: HTMLElement; view: Viewport; ghost: THREE.Group; ws: Workspace; run: Run; replay?: RunRecord; score: Score | null; scores: [number, number][]; spend: [number, number, number | null][]; say: HTMLElement | null; think: HTMLElement | null }
let lanes: Lane[] = [];
let racing = false;
let exporting = 0;
let ticker = 0;
const paneViews = new Map<string, Viewport>();

function feed(l: Lane, cls: string, html: string) {
  const ol = $('.feed', l.pane), near = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 60;
  const li = document.createElement('li'); li.className = cls; li.innerHTML = html;
  ol.append(li);
  while (ol.children.length > 300) ol.firstElementChild!.remove();
  if (near) ol.scrollTop = ol.scrollHeight;
  return li;
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function describe(name: string, input: unknown, out: ToolOutcome): [string, string] {
  const i = (input ?? {}) as Record<string, unknown>, first = out.text.split('\n')[0];
  switch (name) {
    case 'add_parts': {
      const errs = out.text.split('\n').filter(s => s.startsWith('part '));
      return [out.isError ? 'call err' : 'call add', `<b>${esc(first)}</b>${errs.length ? `<span class="err">${esc(errs[0])}${errs.length > 1 ? ` (+${errs.length - 1} more)` : ''}</span>` : ''}`];
    }
    case 'remove_parts': return ['call remove', esc(first)];
    case 'list_parts': return ['call look', 'Listed its parts'];
    case 'render_view': case 'get_reference':
      return ['call look', `${name === 'render_view' ? 'Looked at its model' : 'Looked at the goal'} · ${esc(String(i.view ?? ''))}${i.section ? ' · section' : ''}${out.image ? `<img alt="" src="data:image/png;base64,${out.image}">` : ''}`];
    case 'finish': return ['call done', `Finished: ${esc(String(i.summary ?? ''))}`];
    default: return ['call err', esc(first)];
  }
}

function exec(l: Lane) {
  return async (name: string, input: unknown): Promise<ToolOutcome> => {
    const i = (input ?? {}) as Record<string, unknown>;
    const view = (): View | null => typeof i.view === 'string' && i.view in VIEW_DIRS ? i.view as View : null;
    switch (name) {
      case 'add_parts': { const r = await l.ws.add(input); queueScore(l); return r; }
      case 'remove_parts': { const r = l.ws.remove(input); queueScore(l); return r; }
      case 'list_parts': return { text: l.ws.list() };
      case 'render_view': {
        const v = view();
        if (!v) return { text: `view must be one of ${Object.keys(VIEW_DIRS).join(', ')}.`, isError: true };
        const box = REF_BOX.clone().union(l.ws.bounds());
        return { text: `Your model from ${v.replace('_', ' ')}${i.section ? ', sectioned' : ''}. ${l.ws.parts.size} parts.`, image: studio.png([l.ws.group], v, !!i.section, box) };
      }
      case 'get_reference': {
        const v = view();
        if (!v) return { text: `view must be one of ${Object.keys(VIEW_DIRS).join(', ')}.`, isError: true };
        return { text: `The reference engine from ${v.replace('_', ' ')}${i.section ? ', sectioned' : ''}.`, image: reference(v, !!i.section) };
      }
      case 'finish': return { text: 'Run finished.', finished: String(i.summary ?? '').slice(0, 400) };
      default: return { text: `There is no tool called ${name}.`, isError: true };
    }
  };
}

const pending = new Map<Lane, ReturnType<typeof setTimeout>>();
function queueScore(l: Lane) {
  if (pending.has(l)) return;
  pending.set(l, setTimeout(() => { pending.delete(l); rescore(l); }, 500));
}
function rescore(l: Lane) {
  if (!refMasks.length) return;
  l.score = score(l.ws.parts.values(), studio.depthMaps([l.ws.group]), refMasks);
  l.scores.push([l.replay?.ms ?? l.run.elapsed(), l.score.total]);
  $('.match b', l.pane).textContent = String(Math.round(l.score.total));
}

function setupPane(tag: 'A' | 'B', spec: { label: string; provider: string }): { pane: HTMLElement; view: Viewport; ghost: THREE.Group } {
  const pane = $(`.pane[data-agent="${tag}"]`);
  pane.hidden = false;
  let view = paneViews.get(tag);
  if (!view) {
    view = new Viewport($<HTMLCanvasElement>('canvas', pane), { rim: .9 });
    paneViews.set(tag, view); views.push(view);
    $('[data-fit]', pane).addEventListener('click', () => view!.frame(REF_BOX));
    $('[data-ghost]', pane).addEventListener('click', e => {
      const b = e.currentTarget as HTMLElement, on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      view!.under.children.filter(c => c.name === 'ghost').forEach(c => { c.visible = on; });
    });
  }
  view.setTheme(isDark());
  view.content.clear();
  view.under.children.filter(c => c.name === 'ghost').forEach(c => view!.under.remove(c));
  view.frame(REF_BOX);
  const ghost = goal!.build(ghostMaterial());
  ghost.name = 'ghost';
  ghost.visible = $('[data-ghost]', pane).getAttribute('aria-pressed') === 'true';
  view.under.add(ghost);
  $('.model', pane).textContent = spec.label;
  $('.prov', pane).textContent = short(spec.provider);
  $('.feed', pane).innerHTML = '';
  $('.match b', pane).textContent = '0';
  pane.classList.remove('won', 'lost');
  view.start();
  return { pane, view, ghost };
}

async function drive(l: Lane) {
  const p = info(l.run.spec.provider);
  if (p.kind === 'anthropic') return (await import('./agents/anthropic')).runClaude(l.run);
  if (p.kind === 'openai') return (await import('./agents/openai')).runOpenAI(l.run);
  if (p.kind === 'chat') return (await import('./agents/chat')).runChat(l.run, p);
  return (await import('./agents/mock')).runMock(l.run);
}

function stats(l: Lane) {
  const r = l.run, u = l.replay?.usage ?? r.usage, c = l.replay ? l.replay.cost : r.cost();
  const set = (k: string, v: string) => { $(`[data-s="${k}"]`, l.pane).textContent = v; };
  set('time', clock(l.replay?.ms ?? r.elapsed()));
  set('tokens', `${(u.input + u.cacheRead + u.cacheWrite).toLocaleString()} / ${u.output.toLocaleString()}`);
  set('cost', c === null ? 'n/a' : money(c));
  set('turns', String(l.replay?.turns ?? r.turn));
  set('parts', String(l.ws.parts.size));
}

async function start() {
  if (racing || exporting) return;
  const msg = $('#start-msg');
  msg.textContent = '';
  const specs = await Promise.all([readAgent('A'), readAgent('B')]);
  const bad = specs.find(s => typeof s === 'string');
  if (bad) { msg.textContent = bad as string; return; }
  try { await Promise.all([goalReady, promptReady]); } catch { msg.textContent = 'The goal engine did not load. Reload the page to try again.'; return; }
  if (racing || exporting) return;
  saveKeys();
  racing = true;
  $<HTMLInputElement>('#check-record').disabled = true;
  $<HTMLButtonElement>('#start').disabled = true;
  msg.textContent = 'Checking your keys…';
  const problems = await Promise.all((specs as AgentSpec[]).map(async (s, i) => {
    const kind = info(s.provider).kind;
    const err = kind === 'anthropic' ? await (await import('./agents/anthropic')).checkClaude(s.key, s.model)
      : kind === 'openai' ? await (await import('./agents/openai')).checkOpenAI(s.key, s.model)
      : kind === 'chat' ? await (await import('./agents/chat')).checkChat(info(s.provider), s.key) : null;
    return err && `Agent ${i ? 'B' : 'A'} (${s.label}): ${err}`;
  }));
  if (problems.some(Boolean)) {
    msg.textContent = problems.filter(Boolean).join(' ');
    racing = false;
    $<HTMLInputElement>('#check-record').disabled = false;
    $<HTMLButtonElement>('#start').disabled = false;
    return;
  }
  msg.textContent = '';
  $('#arena').hidden = false; $('#results').hidden = true;
  $('#stop').hidden = false;
  $('.arena-head .kicker').textContent = 'Live';
  $('#verify-msg').textContent = '';
  $('#export-msg').textContent = '';
  result = null; runFile = null;
  lanes.forEach(l => l.ws.dispose());
  $('#arena').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const e = effort(), sys = system();
  const t0 = performance.now();
  const date = new Date().toISOString();
  lanes = (['A', 'B'] as const).map((tag, i) => {
    const spec = specs[i] as AgentSpec;
    const { pane, view, ghost } = setupPane(tag, spec);
    const ws = new Workspace(() => performance.now() - t0);
    view.content.add(ws.group);
    const lane = { tag, pane, view, ghost, ws, score: null, scores: [[0, 0]], spend: [[0, 0, 0]], say: null, think: null } as unknown as Lane;
    lane.run = new Run(spec, e, sys, exec(lane), {
      status: s => { if (!lane.run.done) $('.state', pane).textContent = s; pane.dataset.state = s.toLowerCase(); },
      text: d => { lane.think = null; if (!lane.say) lane.say = feed(lane, 'say', ''); lane.say.textContent += d; },
      thought: d => { lane.say = null; if (!lane.think) lane.think = feed(lane, 'think', ''); lane.think.textContent = (lane.think.textContent + d).slice(-600); },
      call: (name, input, out) => { lane.say = null; lane.think = null; const [cls, html] = describe(name, input, out); feed(lane, cls, html); stats(lane); },
      usage: () => { const u = lane.run.usage; lane.spend.push([performance.now() - t0, u.input + u.cacheRead + u.cacheWrite + u.output, lane.run.cost()]); stats(lane); },
    }, { ms: t0, iso: date });
    return lane;
  });
  ticker = window.setInterval(() => { lanes.forEach(stats); $('#clock').textContent = clock(performance.now() - t0); }, 250);
  await Promise.all(lanes.map(async l => {
    try { await drive(l); } catch (err) { l.run.finish('error', { error: (err as Error).message }); }
    if (failedToStart({ reason: l.run.reason, turns: l.run.turn, calls: l.run.calls })) lanes.forEach(o => { if (o !== l) o.run.stop('void'); });
    const reason = REASONS[l.run.reason] ?? l.run.reason;
    $('.state', l.pane).textContent = reason;
    l.pane.dataset.state = l.run.reason === 'error' ? 'error' : 'done';
    if (l.run.error) feed(l, 'call err', esc(l.run.error));
    else feed(l, 'call done', esc(reason));
  }));
  clearInterval(ticker);
  lanes.forEach(l => { clearTimeout(pending.get(l)); pending.delete(l); rescore(l); stats(l); });
  racing = false;
  $<HTMLInputElement>('#check-record').disabled = false;
  $<HTMLButtonElement>('#start').disabled = false;
  results({ date, records: lanes.map(l => record(l.run, print, goal!.file.bin, l.score!, l.ws.parts.size)) });
}
$('#start').addEventListener('click', start);
$('#stop').addEventListener('click', () => lanes.forEach(l => l.run.stop('stopped')));

// ---- result and exports ----
let result: Result | null = null;
let runFile: RecordFile | null = null;
function results(file: RecordFile) {
  runFile = file;
  const sides = lanes.map((l, i) => {
    const r = file.records[i], u = r.usage;
    return { tag: l.tag, label: r.label, provider: r.provider, score: l.score!.total, parts: l.ws.parts.size,
      ms: r.ms, cost: r.cost, tokensIn: u.input + u.cacheRead + u.cacheWrite, tokensOut: u.output,
      reason: REASONS[r.reason] ?? r.reason, history: l.ws.history, scores: l.scores, spend: l.spend } satisfies Side;
  });
  const [a, b] = sides, diff = b ? a.score - b.score : 0;
  const failed = b ? file.records.findIndex(failedToStart) : -1;
  const winner = !b || failed >= 0 || Math.abs(diff) < .5 ? null : diff > 0 ? 'A' : 'B';
  result = { sides, winner, voided: failed >= 0, fingerprint: print, ghost: studioGhost!, end: Math.max(...sides.map(s => s.ms)) };
  lanes.forEach(l => l.pane.classList.toggle('won', winner === l.tag));
  $('#verdict').textContent = !b ? `${a.label}: ${a.score.toFixed(1)}% match.` : failed >= 0 ? `Race void: ${sides[failed].label} failed on its first turn, so there is no winner.` : winner ? `${sides[winner === 'A' ? 0 : 1].label} wins, ${Math.round(Math.max(a.score, b.score))}% to ${Math.round(Math.min(a.score, b.score))}%.` : `A dead heat at ${Math.round(a.score)}%.`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const rows: [string, (l: Lane, s: Side, r: RunRecord) => string][] = [
    ['Match score', (l, s) => `${s.score.toFixed(1)}%`],
    ['Silhouette (25%)', l => pct(l.score!.silhouette)],
    ['Surface within 10 mm (20%)', l => pct(l.score!.surface)],
    ['Key dimensions (35%)', l => pct(l.score!.dims)], ['Roles covered (20%)', l => `${l.score!.roles} of 18`],
    ...lanes[0].score!.checks.map((c, i) => [`${c.name} (goal ${c.target})`, (l: Lane) => l.score!.checks[i].value] as [string, (l: Lane) => string]),
    ['Parts', (l, s) => String(s.parts)], ['Time', (l, s) => clock(s.ms)],
    ['Tokens in / out', (l, s) => `${s.tokensIn.toLocaleString()} / ${s.tokensOut.toLocaleString()}`],
    ['Cost', (l, s) => money(s.cost)], ['Turns', (l, s, r) => String(r.turns)],
    ['Cost source', (l, s, r) => r.costSource ?? 'n/a'],
    ['Effort', (l, s, r) => r.effort || 'Model default'], ['Ended', (l, s) => s.reason],
  ];
  $('#breakdown').innerHTML = `<table><thead><tr><th></th>${sides.map(s => `<th><span class="tag">${s.tag}</span>${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, value]) => `<tr><th>${esc(label)}</th>${lanes.map((l, i) => `<td>${esc(value(l, sides[i], file.records[i]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const text = postText(result);
  $<HTMLTextAreaElement>('#post').value = text;
  $<HTMLAnchorElement>('#x-intent').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  $('#results').hidden = false;
  $('#result-verification').textContent = lanes.some(l => l.replay) ? $('#verify-msg').textContent : '';
  void drawCard($<HTMLCanvasElement>('#card'), studio, result, '169');
}

async function checkRecords(value: unknown) {
  if (racing || exporting) throw new Error('Wait until the race or export ends to check a record.');
  await Promise.all([goalReady, promptReady]);
  if (racing || exporting) throw new Error('Wait until the race or export ends to check a record.');
  const file = readRecords(value, print, goal!.file.bin);
  if (file.records.length > 2) throw new Error('Choose one record or a two-record race file.');
  racing = true;
  $<HTMLButtonElement>('#start').disabled = true; $<HTMLInputElement>('#check-record').disabled = true;
  $('#results').hidden = true; $('#arena').hidden = false; $('#stop').hidden = true;
  result = null; runFile = null;
  $('#export-msg').textContent = '';
  $('.arena-head .kicker').textContent = 'Replay';
  $('#verify-msg').textContent = 'Replaying the tool calls…';
  $('#arena').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  lanes.forEach(l => l.ws.dispose());
  $$('.pane').forEach((p, i) => { p.hidden = i >= file.records.length; });
  const times = new Map<Lane, (ms: number) => void>();
  lanes = file.records.map((r, i) => {
    const tag = i ? 'B' : 'A', spec: AgentSpec = { provider: r.provider as Provider, model: r.model, label: r.label, key: '', price: null, vision: null, maxOut: null };
    const { pane, view, ghost } = setupPane(tag, spec);
    let time = 0;
    const count = r.calls.reduce((n, c) => n + (!c.skipped && c.name === 'add_parts' && Array.isArray((c.input as any)?.parts) ? (c.input as any).parts.length : 0), 0);
    const ws = new Workspace(() => time, async () => { if (count && !matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(ok => setTimeout(ok, Math.min(160, 2800 / count))); });
    view.content.add(ws.group);
    const run = new Run(spec, r.effort, '', async () => ({ text: '' }), { status() {}, text() {}, thought() {}, call() {}, usage() {} });
    run.finish(r.reason);
    const lane: Lane = { tag, pane, view, ghost, ws, run, score: null, scores: [[0, 0]], spend: [[0, 0, null]], say: null, think: null, replay: r };
    times.set(lane, ms => { time = ms; }); $('.state', pane).textContent = 'Replaying';
    return lane;
  });
  try {
    await Promise.all(lanes.map(async l => {
      await replay(l.replay!, { workspace: l.ws, before: c => times.get(l)!(c.ms), after: c => {
        l.score = score(l.ws.parts.values(), studio.depthMaps([l.ws.group]), refMasks);
        l.scores.push([c.ms, l.score.total]); $('.match b', l.pane).textContent = String(Math.round(l.score.total)); stats(l);
      } });
      rescore(l); stats(l); l.view.draw();
      $('.state', l.pane).textContent = 'Replayed'; l.pane.dataset.state = 'done';
      const r = l.replay!, u = r.usage; l.spend.push([r.ms, u.input + u.output + u.cacheRead + u.cacheWrite, r.cost]);
    }));
    $('#verify-msg').textContent = lanes.map(l => `${l.replay!.label}: ${!l.replay!.score ? `Calibration score: ${l.score!.total.toFixed(1)}. Download the filled record.` : Math.abs(l.replay!.score.total - l.score!.total) <= .5
      ? 'Verified: the score matches (±0.5)' : `The score differs: recorded ${l.replay!.score.total.toFixed(1)}, replayed ${l.score!.total.toFixed(1)}`}`).join(' · ');
    $('#clock').textContent = clock(Math.max(...file.records.map(r => r.ms)));
    results({ date: file.date, records: file.records.map((r, i) => r.score ? r : { ...r, score: lanes[i].score!, parts: lanes[i].ws.parts.size }) });
  } finally { racing = false; $<HTMLButtonElement>('#start').disabled = false; $<HTMLInputElement>('#check-record').disabled = false; }
}
$('#check-record').addEventListener('change', async e => {
  const input = e.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 30_000_000) throw new Error('The run-record file is too large.');
    await checkRecords(JSON.parse(await file.text()));
  } catch (e) { $('#verify-msg').textContent = (e as Error).message; }
  finally { input.value = ''; }
});
async function fetchRecord(path: string) {
  if (!recordPath(path)) throw new Error('The record path is invalid.');
  const res = await fetch(path);
  if (!res.ok) throw new Error('The run record did not load.');
  return res.json();
}
const checkPath = (path: string) => { void fetchRecord(path).then(checkRecords).catch(e => { $('#verify-msg').textContent = e.message; }); };
let leaderboard: Entry[] = [];
const leaderboardReady = (async () => {
  try {
    leaderboard = await loadLeaderboard();
    leaderboardTable($('#leaderboard-table'), leaderboard, checkPath);
    $('#calibration').replaceChildren(...leaderboard.filter(e => e.kind === 'baseline').map(e => {
      const li = document.createElement('li'), a = document.createElement('a'), b = document.createElement('button');
      a.href = e.record; a.textContent = e.label;
      li.append(a, ` · ${e.score === null ? 'Score pending' : e.score.toFixed(1) + '% match'} · ${e.parts} parts${e.note ? ' · ' + e.note : ''} · `);
      b.type = 'button'; b.className = 'link'; b.textContent = 'Check'; b.addEventListener('click', () => checkPath(e.record));
      li.append(b); return li;
    }));
    $$('[data-leader-export^=grid]').forEach(b => { (b as HTMLButtonElement).disabled = !models(leaderboard).length; });
    await promptReady;
    await drawLeaderboard($<HTMLCanvasElement>('#leaderboard-chart'), leaderboard, print);
  } catch (e) { $('#leaderboard-msg').textContent = (e as Error).message; }
})();
$$('[data-leader-export]').forEach(btn => btn.addEventListener('click', async () => {
  const kind = btn.dataset.leaderExport!;
  btn.setAttribute('disabled', '');
  try {
    await leaderboardReady;
    const c = document.createElement('canvas');
    if (kind === 'chart') await drawLeaderboard(c, leaderboard, print);
    else {
      await goalReady;
      const records: RunRecord[] = [];
      for (const e of models(leaderboard).slice(0, 8)) {
        const file = readRecords(await fetchRecord(e.record), print, goal!.file.bin);
        const r = file.records.find(r => r.model === e.model && r.provider === e.provider && r.label === e.label);
        if (!r) throw new Error(`The record for ${e.label} is missing.`);
        records.push(r);
      }
      await drawGrid(c, studio, studioGhost!, records, refMasks, kind === 'grid45' ? '45' : '169');
    }
    const blob = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/png'));
    if (blob) download(blob, `engine-bench-${BENCH_VERSION}-${kind}-${stamp()}.png`);
  } catch (e) { $('#leaderboard-msg').textContent = (e as Error).message; }
  finally { btn.removeAttribute('disabled'); }
}));

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
$$('[data-export]').forEach(btn => btn.addEventListener('click', async () => {
  if (!result || racing) return;
  const kind = btn.dataset.export!, was = btn.textContent;
  exporting++;
  btn.setAttribute('disabled', '');
  try {
    if (kind === 'records' && runFile) {
      download(new Blob([JSON.stringify(runFile, null, 2) + '\n'], { type: 'application/json' }), `engine-bench-${BENCH_VERSION}-${stamp()}-records.json`);
    } else if ((kind === 'grid169' || kind === 'grid45') && runFile) {
      const c = document.createElement('canvas');
      await drawGrid(c, studio, studioGhost!, runFile.records, refMasks, kind === 'grid45' ? '45' : '169');
      const blob = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/png'));
      if (blob) download(blob, `engine-bench-${BENCH_VERSION}-${stamp()}-${kind}.png`);
    } else if (kind === 'card169' || kind === 'card45') {
      const c = document.createElement('canvas');
      await drawCard(c, studio, result, kind === 'card169' ? '169' : '45');
      const blob = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/png'));
      if (blob) download(blob, `engine-bench-${BENCH_VERSION}-${stamp()}-${kind === 'card169' ? '16x9' : '4x5'}.png`);
    } else if (kind === 'clip') {
      const { blob, ext } = await recordClip(studio, result, f => { btn.textContent = `Recording ${Math.round(f * 100)}%`; });
      download(blob, `engine-bench-${BENCH_VERSION}-${stamp()}.${ext}`);
      if (ext !== 'mp4') $('#export-msg').textContent = 'This browser records WebM. X takes MP4, so convert it first, or record in Chrome, Edge or Safari.';
    } else if (kind === 'copy') {
      await navigator.clipboard.writeText($<HTMLTextAreaElement>('#post').value);
      btn.textContent = 'Copied';
      await new Promise(r => setTimeout(r, 1400));
    }
  } catch (e) {
    $('#export-msg').textContent = (e as Error).message;
  } finally {
    exporting--;
    btn.textContent = was; btn.removeAttribute('disabled');
  }
}));

$<HTMLTextAreaElement>('#post').addEventListener('input', e => {
  $<HTMLAnchorElement>('#x-intent').href = `https://x.com/intent/post?text=${encodeURIComponent((e.target as HTMLTextAreaElement).value)}`;
});
