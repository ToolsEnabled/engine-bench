// Exports for X: a share card (16:9 or 4:5), a timelapse video and the post text.
import * as THREE from 'three';
import type { Studio } from './studio';
import { REF_BOX } from './studio';
import type { Version } from './workspace';
import { BENCH_VERSION } from './version';
import { KICKOFF } from './agents/common';
import { replay, type RunRecord } from './records';
import { score } from './score';
import type { Entry } from './leaderboard';

export interface Side {
  tag: 'A' | 'B'; label: string; provider: string; score: number; parts: number; ms: number;
  cost: number | null; tokensIn: number; tokensOut: number; reason: string;
  history: Version[]; scores: [number, number][]; // [ms, total]
  spend: [number, number, number | null][]; // [ms, tokens, cost]
}
export interface Result { sides: Side[]; winner: 'A' | 'B' | null; fingerprint: string; ghost: THREE.Group; end: number }

const RED = '#ef1d2f', INK = '#f7f4f3', MUTE = '#a3a3ab', DIM = '#6d6d75';
const PROMPT_LINE = `Prompt: "${KICKOFF}" · one shot · no hand-holding`;
export const clock = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const money = (c: number | null) => c === null ? 'n/a' : c < 10 ? `$${c.toFixed(2)}` : `$${c.toFixed(0)}`;
const kilo = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

// The model at a moment of the run, rebuilt from the history so the replay shows what existed then.
function snapshot(history: Version[], t: number, pop = 0): THREE.Group {
  const g = new THREE.Group();
  for (const v of history) {
    if (v.t0 > t || (v.t1 !== Infinity && v.t1 <= t)) continue;
    const m = new THREE.Mesh(v.mesh.geometry, v.mesh.material);
    m.position.copy(v.mesh.position); m.quaternion.copy(v.mesh.quaternion);
    if (pop) { const k = Math.min(1, (t - v.t0) / pop); m.scale.setScalar(Math.max(.001, 1 - Math.pow(1 - k, 3))); }
    g.add(m);
  }
  return g;
}

function render(studio: Studio, ghost: THREE.Object3D, model: THREE.Object3D, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(studio.draw([model], { view: 'iso', width: w, height: h, box: REF_BOX, background: null, axes: false, under: [ghost], margin: .9 }), 0, 0);
  return c;
}

function rounded(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  x.beginPath(); x.roundRect(l, t, w, h, r);
}

function fit(x: CanvasRenderingContext2D, text: string, max: number): string {
  if (x.measureText(text).width <= max) return text;
  while (text.length > 1 && x.measureText(text + '…').width > max) text = text.slice(0, -1);
  return text + '…';
}

function backdrop(x: CanvasRenderingContext2D, W: number, H: number) {
  x.fillStyle = '#09090a'; x.fillRect(0, 0, W, H);
  const g = x.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, H * .95);
  g.addColorStop(0, '#ef1d2f40'); g.addColorStop(1, '#ef1d2f00');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#ffffff08'; x.lineWidth = 1;
  for (let i = 40; i < W; i += 40) { x.beginPath(); x.moveTo(i + .5, 0); x.lineTo(i + .5, H); x.stroke(); }
  for (let i = 40; i < H; i += 40) { x.beginPath(); x.moveTo(0, i + .5); x.lineTo(W, i + .5); x.stroke(); }
}

interface TileState { parts: number; score: number; ms: number; cost: number | null; tokens: number; winner: boolean; final: boolean }

function tile(x: CanvasRenderingContext2D, s: Side, st: TileState, img: HTMLCanvasElement, l: number, t: number, w: number, h: number, u: number) {
  rounded(x, l, t, w, h, 22 * u);
  x.fillStyle = '#111114e6'; x.fill();
  x.lineWidth = 2 * u; x.strokeStyle = st.winner ? RED : '#2a2a30'; x.stroke();
  x.save(); rounded(x, l, t, w, h, 22 * u); x.clip();
  const ih = h - 150 * u, scale = Math.min(w / img.width, ih / img.height);
  x.drawImage(img, l + (w - img.width * scale) / 2, t + 54 * u + (ih - 54 * u - img.height * scale) / 2 + 8 * u, img.width * scale, img.height * scale);
  x.restore();
  x.fillStyle = st.winner ? RED : '#26262b'; rounded(x, l + 20 * u, t + 18 * u, 34 * u, 30 * u, 8 * u); x.fill();
  x.fillStyle = '#fff'; x.font = `700 ${17 * u}px Geist, sans-serif`; x.textAlign = 'center'; x.fillText(s.tag, l + 37 * u, t + 39 * u);
  x.textAlign = 'left'; x.fillStyle = INK; x.font = `650 ${22 * u}px Geist, sans-serif`;
  x.fillText(fit(x, s.label, w - 200 * u), l + 66 * u, t + 40 * u);
  if (st.winner && st.final) {
    x.font = `600 ${13 * u}px "Geist Mono", monospace`;
    const tw = x.measureText('WINNER').width + 22 * u;
    x.fillStyle = RED; rounded(x, l + w - tw - 20 * u, t + 18 * u, tw, 30 * u, 15 * u); x.fill();
    x.fillStyle = '#fff'; x.fillText('WINNER', l + w - tw - 9 * u, t + 38 * u);
  }
  const base = t + h - 34 * u;
  x.fillStyle = st.winner ? '#ff5a64' : INK; x.font = `720 ${64 * u}px Geist, sans-serif`;
  const sc = String(Math.round(st.score));
  x.fillText(sc, l + 24 * u, base - 30 * u);
  const sw = x.measureText(sc).width;
  x.fillStyle = MUTE; x.font = `500 ${18 * u}px Geist, sans-serif`; x.fillText('% match', l + 30 * u + sw, base - 32 * u);
  x.font = `500 ${15 * u}px "Geist Mono", monospace`; x.fillStyle = MUTE;
  x.fillText(`${st.parts} parts · ${clock(st.ms)} · ${money(st.cost)} · ${kilo(st.tokens)} tokens`, l + 26 * u, base + 4 * u);
}

function chrome(x: CanvasRenderingContext2D, r: { fingerprint: string }, W: number, H: number, u: number, headline: string, subtitle = PROMPT_LINE) {
  x.textAlign = 'left'; x.fillStyle = RED; x.font = `600 ${15 * u}px "Geist Mono", monospace`;
  x.fillText(`Engine Bench ${BENCH_VERSION}`, 48 * u, 58 * u);
  x.textAlign = 'right'; x.fillStyle = MUTE; x.fillText('toolsenabled.ai/bench', W - 48 * u, 58 * u);
  x.textAlign = 'left'; x.fillStyle = INK; x.font = `700 ${40 * u}px Geist, sans-serif`;
  x.fillText(fit(x, headline, W - 96 * u), 48 * u, 112 * u);
  x.fillStyle = MUTE; x.font = `500 ${18 * u}px Geist, sans-serif`;
  x.fillText(fit(x, subtitle, W - 96 * u), 48 * u, 148 * u);
  x.fillStyle = DIM; x.font = `500 ${14 * u}px "Geist Mono", monospace`;
  x.fillText('894-part goal · one prompt · same tools', 48 * u, H - 34 * u);
  x.textAlign = 'right'; x.fillText(`prompt ${r.fingerprint}`, W - 48 * u, H - 34 * u);
}

async function fonts() {
  try { await Promise.all(['700 40px Geist', '500 15px "Geist Mono"'].map(f => document.fonts.load(f))); } catch { /* the card falls back to system fonts */ }
}

export async function drawCard(canvas: HTMLCanvasElement, studio: Studio, r: Result, shape: '169' | '45') {
  await fonts();
  const W = shape === '169' ? 1600 : 1080, H = shape === '169' ? 900 : 1350, u = shape === '169' ? 1.333 : 1;
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext('2d')!;
  backdrop(x, W, H);
  chrome(x, r, W, H, u, headline(r));
  const top = 180 * u, gap = 24 * u;
  const boxes = r.sides.length === 1 ? [[48 * u, top, W - 96 * u, H - top - 70 * u]] : shape === '169'
    ? [[48 * u, top, (W - 96 * u - gap) / 2, H - top - 70 * u], [48 * u + (W - 96 * u + gap) / 2, top, (W - 96 * u - gap) / 2, H - top - 70 * u]]
    : [[48, top, W - 96, (H - top - 70 - gap) / 2], [48, top + (H - top - 70 + gap) / 2, W - 96, (H - top - 70 - gap) / 2]];
  r.sides.forEach((s, i) => {
    const [l, t, w, h] = boxes[i];
    const model = snapshot(s.history, Infinity);
    const img = render(studio, r.ghost, model, Math.round(w * 1.4), Math.round((h - 150 * u) * 1.4));
    tile(x, s, { parts: s.parts, score: s.score, ms: s.ms, cost: s.cost, tokens: s.tokensIn + s.tokensOut, winner: r.winner === s.tag, final: true }, img, l, t, w, h, u);
  });
}

export function postText(r: Result): string {
  const [a, b] = r.sides;
  const line = (s: Side) => `${s.label}: ${Math.round(s.score)}% match, ${s.parts} parts, ${clock(s.ms)}, ${money(s.cost)}`;
  return `Engine Bench ${BENCH_VERSION}: ${a.label}${b ? ` vs ${b.label}` : ''}\n\n${PROMPT_LINE}\nSame CAD tools. No budget. Goal: a real 1990s 1.6 L inline-four, 894 parts.\n\n${r.sides.map(line).join('\n')}\n\n${headline(r)}. Prompt ${r.fingerprint}.\nRun your own: https://toolsenabled.ai/bench/`;
}

function headline(r: Result) {
  return r.sides.length === 1 ? `${r.sides[0].label}: ${r.sides[0].score.toFixed(1)}% match`
    : r.winner ? `${r.sides.find(s => s.tag === r.winner)!.label} wins` : 'A dead heat';
}

export async function drawLeaderboard(canvas: HTMLCanvasElement, entries: Entry[], fingerprint: string) {
  await fonts();
  const W = 1600, H = 900, u = 1.333;
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext('2d')!;
  backdrop(x, W, H);
  chrome(x, { fingerprint }, W, H, u, `Engine Bench ${BENCH_VERSION}`, 'Match score vs the real 894-part engine · one prompt · same tools');
  const ranked = entries.filter(e => e.kind === 'model' && e.score !== null).sort((a, b) => b.score! - a.score!);
  const baselines = entries.filter(e => e.kind === 'baseline' && e.score !== null);
  const left = 410, right = W - 120, top = 315, bottom = H - 115, width = right - left;
  const row = Math.min(88, (bottom - top) / Math.max(1, ranked.length));
  x.font = '500 18px "Geist Mono", monospace'; x.textAlign = 'center';
  for (let n = 0; n <= 100; n += 20) {
    const pos = left + width * n / 100;
    x.strokeStyle = '#ffffff16'; x.beginPath(); x.moveTo(pos, top - 12); x.lineTo(pos, bottom); x.stroke();
    x.fillStyle = DIM; x.fillText(String(n), pos, bottom + 32);
  }
  ranked.forEach((e, i) => {
    const y = top + i * row, bar = Math.max(1, width * e.score! / 100);
    x.textAlign = 'right'; x.fillStyle = INK; x.font = `600 ${Math.min(25, row * .45)}px Geist, sans-serif`;
    x.fillText(fit(x, e.label, left - 90), left - 24, y + row * .55);
    x.fillStyle = i ? RED : '#ff5a64'; rounded(x, left, y + row * .15, bar, row * .58, 5); x.fill();
    x.textAlign = 'left'; x.fillStyle = INK; x.font = `650 ${Math.min(23, row * .4)}px "Geist Mono", monospace`;
    x.fillText(e.score!.toFixed(1), left + bar + 12, y + row * .55);
  });
  baselines.forEach((e, i) => {
    const pos = left + width * e.score! / 100;
    x.strokeStyle = MUTE; x.lineWidth = 2; x.setLineDash([8, 7]);
    x.beginPath(); x.moveTo(pos, top - 12); x.lineTo(pos, bottom); x.stroke(); x.setLineDash([]);
    x.textAlign = pos > W - 350 ? 'right' : 'left'; x.fillStyle = MUTE; x.font = '500 17px "Geist Mono", monospace';
    x.fillText(`${e.label} ${e.score!.toFixed(1)}`, pos, 250 + i * 22);
  });
  if (!ranked.length) {
    x.font = '600 32px Geist, sans-serif';
    const msg = 'No model runs yet. Be the first.', w = x.measureText(msg).width + 56;
    x.fillStyle = '#09090af2'; rounded(x, (left + right) / 2 - w / 2, top + 108, w, 64, 14); x.fill();
    x.textAlign = 'center'; x.fillStyle = INK; x.fillText(msg, (left + right) / 2, top + 150);
  }
}

export async function drawGrid(canvas: HTMLCanvasElement, studio: Studio, ghost: THREE.Group, records: RunRecord[], refMaps: Float32Array[], shape: '169' | '45') {
  if (!records.length || records.length > 8) throw new Error('Choose one to eight run records for a grid.');
  await fonts();
  const W = shape === '169' ? 1600 : 1080, H = shape === '169' ? 900 : 1350, u = shape === '169' ? 1.333 : 1;
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext('2d')!;
  backdrop(x, W, H);
  chrome(x, { fingerprint: records[0].prompt }, W, H, u, 'One prompt. Every model.');
  const cols = shape === '169' ? Math.min(4, records.length) : Math.min(2, records.length), rows = Math.ceil(records.length / cols);
  const gap = 18 * u, top = 180 * u, left = 48 * u;
  const w = (W - left * 2 - gap * (cols - 1)) / cols, h = (H - top - 70 * u - gap * (rows - 1)) / rows;
  for (const [i, r] of records.entries()) {
    const ws = await replay(r);
    try {
      const total = score(ws.parts.values(), studio.depthMaps([ws.group]), refMaps).total;
      const l = left + (i % cols) * (w + gap), t = top + Math.floor(i / cols) * (h + gap);
      rounded(x, l, t, w, h, 16); x.fillStyle = '#111114'; x.fill(); x.strokeStyle = '#2a2a30'; x.lineWidth = 2; x.stroke();
      const labelSize = Math.min(25 * u, w / 15), footer = 76 * u;
      const img = render(studio, ghost, ws.group, Math.round(w), Math.max(1, Math.round(h - footer)));
      x.drawImage(img, l, t, w, h - footer);
      x.textAlign = 'center'; x.fillStyle = INK; x.font = `650 ${labelSize}px Geist, sans-serif`;
      x.fillText(fit(x, r.label, w - 24), l + w / 2, t + h - 43 * u);
      x.fillStyle = '#ff5a64'; x.font = `600 ${labelSize}px "Geist Mono", monospace`;
      x.fillText(`${total.toFixed(1)}% match`, l + w / 2, t + h - 16 * u);
    } finally { ws.dispose(); }
  }
}

const TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.4d002a', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

// Replays both builds on one clock: 12 seconds of build, then the result held for 3.
export async function recordClip(studio: Studio, r: Result, progress: (f: number) => void): Promise<{ blob: Blob; ext: string }> {
  await fonts();
  const type = TYPES.find(t => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('This browser cannot record video.');
  const W = 1920, H = 1080, u = 1.6, BUILD = 12000, HOLD = 3000;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext('2d')!;
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 16_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>(ok => { rec.onstop = () => ok(); });
  const end = Math.max(1, r.end), gap = 24 * u, top = 180 * u, w = (W - 96 * u - gap * (r.sides.length - 1)) / r.sides.length, h = H - top - 70 * u;
  const at = (scores: [number, number][], t: number) => { let v = 0; for (const [ms, s] of scores) if (ms <= t) v = s; return v; };
  const spentAt = (spend: Side['spend'], t: number): [number, number | null] => { let v: [number, number | null] = [0, 0]; for (const [ms, n, c] of spend) if (ms <= t) v = [n, c]; return v; };
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>(done => {
    const frame = () => {
      const e = performance.now() - t0, k = Math.min(1, e / BUILD), t = k * end, final = e >= BUILD;
      backdrop(x, W, H);
      chrome(x, r, W, H, u, final ? headline(r) : r.sides.map(s => s.label).join(' vs '));
      r.sides.forEach((s, i) => {
        const tt = final ? Infinity : t;
        const model = snapshot(s.history, tt, end / BUILD * 600);
        const img = render(studio, r.ghost, model, Math.round(w * 1.1), Math.round((h - 150 * u) * 1.1));
        const live = Math.min(tt, s.ms);
        tile(x, s, {
          parts: model.children.length, score: final ? s.score : at(s.scores, tt), ms: live,
          cost: final ? s.cost : spentAt(s.spend, tt)[1],
          tokens: final ? s.tokensIn + s.tokensOut : spentAt(s.spend, tt)[0],
          winner: final && r.winner === s.tag, final,
        }, img, 48 * u + i * (w + gap), top, w, h, u);
      });
      progress(Math.min(1, e / (BUILD + HOLD)));
      if (e < BUILD + HOLD) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });
  rec.stop();
  await stopped;
  return { blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' };
}
