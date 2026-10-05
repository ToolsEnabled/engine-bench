// Local preview that mimics production: the live site's files, the bench on top, and the same headers.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOTS = ['site', ...(process.env.LIVE_SITE ? [process.env.LIVE_SITE] : [])];
const UPSTREAM = 'https://toolsenabled.ai'; // shared site files (site.css, fonts, three.js) when no local copy is given
const BASE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
const HOSTS = 'https://api.anthropic.com https://api.openai.com https://openrouter.ai https://generativelanguage.googleapis.com https://api.x.ai https://api.mistral.ai https://api.deepseek.com https://api.groq.com https://api.together.xyz https://api.fireworks.ai https://api.cerebras.ai https://api.moonshot.ai https://dashscope-intl.aliyuncs.com https://api.cohere.ai https://router.huggingface.co';
const CSP = { site: `${BASE}; connect-src 'self'`, bench: `${BASE}; connect-src 'self' ${HOSTS}` };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8' };
createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  for (const root of ROOTS) {
    const file = join(root, path);
    try {
      if (!(await stat(file)).isFile()) continue;
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store',
        'Content-Security-Policy': path.startsWith('/bench/') ? CSP.bench : CSP.site, 'X-Content-Type-Options': 'nosniff' });
      return res.end(await readFile(file));
    } catch { /* try the next root */ }
  }
  if (/^\/(static\/site\.css|fonts\/|vendor\/|brand-icon\.svg)/.test(path)) {
    try {
      const up = await fetch(UPSTREAM + path);
      if (up.ok) { res.writeHead(200, { 'Content-Type': up.headers.get('content-type') || TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); return res.end(Buffer.from(await up.arrayBuffer())); }
    } catch { /* offline */ }
  }
  res.writeHead(404); res.end('not found');
}).listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log('preview on http://127.0.0.1:' + (process.env.PORT || 8787)));
