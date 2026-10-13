// Runs tools/agents.test.ts: the provider loops against a scripted fetch (no network, no keys, nothing spent),
// plus the race, record and page checks that need no browser.   node tools/check-agents.mjs
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const temp = await mkdtemp(resolve('.agents-check-'));
let status = 1;
try {
  const file = `${temp}/agents.test.mjs`;
  await build({ entryPoints: ['tools/agents.test.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: file, logLevel: 'warning' });
  status = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-reporter=spec', file], { stdio: 'inherit' }).status ?? 1;
} finally { await rm(temp, { recursive: true, force: true }); }
process.exit(status);
