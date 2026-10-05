// Scores the scripted baseline records in a real browser (the score needs WebGL) and writes the
// filled records and their leaderboard entries. Usage: node tools/fill-baselines.cjs [base-url]
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8793', DIR = 'site/static/bench/results';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  const board = JSON.parse(fs.readFileSync(`${DIR}/leaderboard.json`, 'utf8'));
  for (const e of board.filter(e => e.kind === 'baseline')) {
    const p = await ctx.newPage();
    p.on('pageerror', err => console.log('PAGEERROR', err.message));
    await p.goto(BASE + '/bench/');
    await p.waitForFunction(() => !document.querySelector('#goal-loading'), null, { timeout: 90000 });
    await p.setInputFiles('#check-record', path.join(DIR, path.basename(e.record)));
    await p.waitForFunction(() => /Calibration score|Verified|differs/.test(document.querySelector('#verify-msg').textContent), null, { timeout: 120000 });
    console.log(e.model, '|', await p.textContent('#verify-msg'));
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-export=records]')]);
    const file = JSON.parse(fs.readFileSync(await d.path(), 'utf8'));
    const r = (file.records || [file])[0];
    fs.writeFileSync(path.join(DIR, path.basename(e.record)), JSON.stringify(r, null, 2) + '\n');
    Object.assign(e, { score: +r.score.total.toFixed(1), silhouette: +r.score.silhouette.toFixed(3), surface: +r.score.surface.toFixed(3), dims: +r.score.dims.toFixed(3), coverage: +r.score.coverage.toFixed(3), label: r.label });
    delete e.note;
    await p.close();
  }
  fs.writeFileSync(`${DIR}/leaderboard.json`, JSON.stringify(board, null, 2) + '\n');
  console.log(board.map(e => `${e.label}: ${e.score}`).join('\n'));
  await b.close();
})().catch(err => { console.error('FILL FAILED', err); process.exit(1); });
