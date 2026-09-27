// serve.mjs — zero-dependency local static server for the offline mirror.
// Run:  node serve.mjs   then open the printed URL. Ctrl+C to stop.
// A real HTTP origin is REQUIRED: browsers block ES modules over file://,
// so the page's React/animation bundles only run when served like this.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// NOTE: the mirror's asset URLs are hard-rewritten to http://localhost:8137, so keep 8137.
const PORT = process.argv[2] || process.env.PORT || 8137;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
  const abs = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(abs, (err, buf) => {
    if (err) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found: ' + rel); return; }
    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log('Serving offline mirror at  http://localhost:' + PORT + '/');
  console.log('Press Ctrl+C to stop.');
});
