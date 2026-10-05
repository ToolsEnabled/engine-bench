import { clock, money } from './share';

export interface Entry {
  model: string; label: string; provider: string; score: number | null; silhouette: number | null;
  surface: number | null; dims: number | null; coverage: number | null; parts: number; ms: number;
  cost: number | null; tokens: number; date: string; record: string; kind: 'model' | 'baseline'; note?: string;
}
export const models = (entries: Entry[]) => entries.filter(e => e.kind === 'model' && e.score !== null).sort((a, b) => b.score! - a.score!);
export const recordPath = (path: string) => /^\/static\/bench\/results\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.json$/.test(path) && !path.includes('..');

export async function loadLeaderboard(): Promise<Entry[]> {
  const res = await fetch('/static/bench/results/leaderboard.json');
  if (!res.ok) throw new Error('The leaderboard did not load. Reload the page to try again.');
  const data = await res.json(), entries: Entry[] = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(entries)) throw new Error('The leaderboard file is invalid.');
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  for (const e of entries) {
    if (!e || !['model', 'baseline'].includes(e.kind) || ![e.model, e.label, e.provider, e.date].every(s => typeof s === 'string')
      || !recordPath(e.record) || ![e.parts, e.ms, e.tokens].every(num) || (e.cost !== null && !num(e.cost))
      || (e.score !== null && (!num(e.score) || e.score > 100))
      || ![e.silhouette, e.surface, e.dims, e.coverage].every(n => n === null || (num(n) && n <= 1)))
      throw new Error('The leaderboard has an invalid entry.');
  }
  return entries;
}

export function leaderboardTable(box: HTMLElement, entries: Entry[], check: (path: string) => void) {
  box.replaceChildren();
  const ranked = models(entries);
  if (!ranked.length) { box.textContent = 'No model runs yet.'; return; }
  const table = document.createElement('table'), head = table.createTHead().insertRow();
  for (const text of ['Rank', 'Model', 'Match', 'Silhouette', 'Surface', 'Dimensions', 'Coverage', 'Parts', 'Time', 'Cost', 'Tokens', 'Date', 'Record']) {
    const th = document.createElement('th'); th.textContent = text; head.append(th);
  }
  const body = table.createTBody();
  ranked.forEach((e, i) => {
    const row = body.insertRow();
    const pct = (n: number | null) => n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`;
    for (const text of [String(i + 1), e.label, e.score!.toFixed(1), pct(e.silhouette), pct(e.surface), pct(e.dims), pct(e.coverage),
      String(e.parts), clock(e.ms), money(e.cost), e.tokens.toLocaleString(), e.date.slice(0, 10)]) row.insertCell().textContent = text;
    const cell = row.insertCell(), a = document.createElement('a'), b = document.createElement('button');
    a.href = e.record; a.textContent = 'JSON'; a.download = '';
    b.type = 'button'; b.className = 'link'; b.textContent = 'Check'; b.addEventListener('click', () => check(e.record));
    cell.append(a, ' · ', b);
  });
  box.append(table);
}
