// Local preview: node dev/server.mjs, then open http://localhost:8888. Data lives in memory.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handleApi, handleMcp } from '../lib/server.mjs';
import { memoryStore } from '../lib/memory-store.mjs';

const store = memoryStore();
const root = new URL('../public/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT || 8888);

createServer(async (req, res) => {
  const url = `http://localhost:${port}${req.url}`;
  if (req.url.startsWith('/api/') || req.url.startsWith('/mcp/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await (req.url.startsWith('/api/') ? handleApi : handleMcp)(new Request(url, { method: req.method, headers: req.headers, body }), { store });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const path = normalize(join(root, new URL(url).pathname === '/' ? 'index.html' : new URL(url).pathname));
  if (!path.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`Laventina preview on http://localhost:${port}`));
