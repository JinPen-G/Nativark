// crawl.mjs — offline mirror of a Framer-published landing page (personal study copy).
// Fetches the page + every first-party asset (JS modules, fonts, images) it references,
// recursively follows the ES-module import graph, then rewrites all CDN URLs to local paths.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.cwd();
const START = 'https://primefold.ai/';
// Rewrite target: assets become absolute URLs on this local origin, so Framer's runtime
// new URL(relative, base) calls (used to load CMS data chunks) resolve correctly — a
// root-relative base like "/assets/..." throws "Invalid base URL" and crashes the page.
const LOCAL_ORIGIN = 'http://localhost:8137';
const LOCALIZE = new Set([
  'framerusercontent.com',
  'fonts.gstatic.com',
  'fonts.googleapis.com',
  'app.framerstatic.com',
]);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TEXT_EXT = new Set(['.mjs', '.js', '.css', '.json', '']);

const map = new Map();       // canonical URL -> local root path (/assets/...)
const enqueued = new Set();
const queue = [];
const textFiles = [];
let ok = 0, fail = 0;
const failures = [];

function hash8(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function canonical(u) {
  return u.replace(/&amp;/g, '&').replace(/[)"'`,;.\\]+$/, '');
}

function localRootPath(canon) {
  const url = new URL(canon);
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const ext = path.extname(p);
  if (url.search) {
    const h = hash8(url.search);
    p = ext ? p.slice(0, -ext.length) + '__q' + h + ext : p + '__q' + h;
  }
  return '/assets/' + url.host + p;
}
const URL_RE = /https?:\/\/[^\s"'`)\\<>]+/g;

function pushLocal(out, u) {
  try { if (LOCALIZE.has(new URL(u).host)) out.push(u); } catch {}
}

function extractUrls(text, base) {
  const out = [];
  const m = text.match(URL_RE);
  if (m) for (const raw of m) pushLocal(out, canonical(raw));
  // Relative specifiers resolved against THIS file's own URL (base): Framer lazy-loads
  // page/section chunks with relative dynamic imports, e.g. import(`./XXXX.mjs`).
  const REL = [
    /import\(\s*[`'"](\.\.?\/[^`'"]+)[`'"]/g,
    /\bfrom\s*[`'"](\.\.?\/[^`'"]+)[`'"]/g,
    /\bimport\s*[`'"](\.\.?\/[^`'"]+)[`'"]/g,
    /new URL\(\s*[`'"](\.\.?\/[^`'"]+)[`'"]\s*,\s*import\.meta\.url/g,
  ];
  if (base) for (const re of REL) {
    let r;
    while ((r = re.exec(text))) { try { pushLocal(out, new URL(r[1], base).href); } catch {} }
  }
  // new URL(`./x`, `https://absolute-literal-base`)
  const ABS = /new URL\(\s*[`'"](\.\.?\/[^`'"]+)[`'"]\s*,\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g;
  let a;
  while ((a = ABS.exec(text))) { try { pushLocal(out, new URL(a[1], canonical(a[2])).href); } catch {} }
  return out;
}

function isTextUrl(canon) {
  const ext = path.extname(new URL(canon).pathname).toLowerCase();
  return TEXT_EXT.has(ext);
}

async function fetchBuf(u) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30000);
  try {
    const res = await fetch(u, {
      headers: { 'User-Agent': UA, Referer: START, Accept: '*/*' },
      redirect: 'follow',
      signal: ac.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}

function saveBuf(localRoot, buf) {
  const abs = path.join(OUT, localRoot.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return abs;
}

function enqueue(canon) {
  if (enqueued.has(canon)) return;
  enqueued.add(canon);
  queue.push(canon);
}
async function processOne(canon) {
  try {
    const buf = await fetchBuf(canon);
    const localRoot = localRootPath(canon);
    map.set(canon, localRoot);
    const abs = saveBuf(localRoot, buf);
    if (isTextUrl(canon)) {
      textFiles.push(abs);
      for (const child of extractUrls(buf.toString('utf8'), canon)) enqueue(child);
    }
    ok++;
    if (ok % 25 === 0) console.log('  ...' + ok + ' downloaded (queue ' + queue.length + ')');
  } catch (e) {
    fail++;
    failures.push(canon + ' :: ' + e.message);
  }
}

async function drain(concurrency = 10) {
  return new Promise((resolve) => {
    let active = 0;
    const tick = () => {
      if (queue.length === 0 && active === 0) return resolve();
      while (active < concurrency && queue.length) {
        const canon = queue.shift();
        active++;
        processOne(canon).finally(() => { active--; tick(); });
      }
    };
    tick();
  });
}

function rewrite(text) {
  const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [canon, localRoot] of entries) {
    const local = LOCAL_ORIGIN + localRoot;
    if (text.includes(canon)) text = text.split(canon).join(local);
    const amp = canon.replace(/&/g, '&amp;');
    if (amp !== canon && text.includes(amp)) text = text.split(amp).join(local);
  }
  return text;
}
async function main() {
  console.log('Fetching landing page ' + START);
  const html = (await fetchBuf(START)).toString('utf8');
  const indexAbs = path.join(OUT, 'index.html');
  fs.writeFileSync(indexAbs, html);
  for (const u of extractUrls(html, START)) enqueue(u);
  console.log('Seeded ' + queue.length + ' asset URLs. Downloading...');
  await drain(10);
  console.log('Downloaded ' + ok + ' assets (' + fail + ' failed). Rewriting to local paths...');
  fs.writeFileSync(indexAbs, rewrite(fs.readFileSync(indexAbs, 'utf8')));
  for (const abs of textFiles) {
    try { fs.writeFileSync(abs, rewrite(fs.readFileSync(abs, 'utf8'))); } catch {}
  }
  fs.writeFileSync(path.join(OUT, '_failures.log'), failures.join('\n') + '\n');
  console.log('DONE — index.html + ' + ok + ' assets under ./assets/. Failures -> _failures.log');
}
main();
