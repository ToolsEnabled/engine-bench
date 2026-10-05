// Bundles the page script. three.js stays external: the site already hosts it at /vendor/.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const out = 'site/static/bench/js';
rmSync(out, { recursive: true, force: true });
// three-bvh-csg 0.0.18 still passes an option three-mesh-bvh 0.9 renamed; same meaning, no console warning.
const bvhOption = { name: 'bvh-option', setup(b) { b.onLoad({ filter: /three-bvh-csg[\\/]src[\\/]core[\\/]Brush\.js$/ }, async a => ({
  contents: readFileSync(a.path, 'utf8').replace('maxLeafSize: 3', 'targetLeafSize: 3'), loader: 'js' })); } };
const three = { name: 'three-external', setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: '/vendor/three.module.min.js', external: true })); } };
const result = await build({
  entryPoints: ['src/main.ts'], bundle: true, format: 'esm', splitting: true, outdir: out,
  entryNames: '[name]', chunkNames: 'chunk-[hash]', minify: process.env.DEBUG ? false : true, target: 'es2022',
  plugins: [three, bvhOption], legalComments: 'none', metafile: true, logLevel: 'warning',
});
// Licences of everything bundled, kept next to the code.
const pkgs = new Set();
for (const f of Object.keys(result.metafile.inputs)) { const m = f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); if (m) pkgs.add(m[1]); }
let text = 'Third-party code bundled into these files, with its licence.\n';
for (const p of [...pkgs].sort()) {
  const dir = `node_modules/${p}`, pj = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  const lic = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'].map(n => `${dir}/${n}`).find(existsSync);
  text += `\n==== ${p} ${pj.version} (${pj.license}) ====\n${lic ? readFileSync(lic, 'utf8').trim() : 'Licence: ' + pj.license}\n`;
}
writeFileSync(`${out}/THIRD-PARTY-LICENSES.txt`, text);
for (const [f, o] of Object.entries(result.metafile.outputs)) console.log(f.padEnd(52), (o.bytes / 1024).toFixed(0), 'KB');
console.log('bundled packages:', [...pkgs].join(', '));
