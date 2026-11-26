// Tiny static server for local testing: serves the site root and, under /__dev/, tools/dev/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeKV } from './mock-kv.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const port = +process.argv[2] || 8123;
// Local stand-in for Cloudflare Pages Functions: runs the real /api handler against a file-backed mock KV.
const apiMod = await import(pathToFileURL(path.join(root, 'functions/api/[[path]].js')).href);
const env = { SLIPSTREAM_KV: makeKV(path.join(root, '.dev-kv.json')) };
async function runApi(req, res) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const request = new Request('http://localhost' + req.url, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': '127.0.0.1' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const r = await apiMod.onRequest({ request, env });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}
http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/api/')) return runApi(req, res).catch(() => { res.writeHead(500); res.end('api error'); });
  let file = url.startsWith('/__dev/') ? path.join(root, 'tools/dev', url.slice(7)) : path.join(root, url);
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404 ' + url); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log('serving on', port));
