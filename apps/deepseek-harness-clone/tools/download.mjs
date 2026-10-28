// Downloads the public deployment unchanged, including both locales and lazy chunks.
// Desktop installers and external product/documentation sites remain official links.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://www.deepseek.com';
const pending = [], seen = new Set(), files = [], failures = [];
let resolveChunk = null, resolveCSS = null;
const chunkIDs = new Set([113, 6893, 9265, 1486, 759, 334, 6191, 8091, 5565]);
function enqueue(ref, base = origin) {
  let u; try { u = new URL(ref, base); } catch { return; }
  if (u.origin !== origin || /\.(exe|dmg|zip|map)$/.test(u.pathname)) return;
  u.search = ''; u.hash = '';
  if (seen.has(u.href)) return;
  seen.add(u.href); pending.push(u.href);
}
function chunkResolvers(text) {
  // Webpack's filename resolvers are pure table lookups. Extract just these two functions.
  for (const key of ['u', 'miniCssF']) {
    const match = new RegExp('\\.' + key + '\\s*=\\s*(function\\s*\\([^)]*\\)\\s*\\{)').exec(text);
    if (!match) continue;
    const start = match.index + match[0].indexOf('function');
    let depth = 1, end = match.index + match[0].length;
    for (; end < text.length && depth; end++) {
      if (text[end] === '{') depth++;
      if (text[end] === '}') depth--;
    }
    const fn = vm.runInNewContext('(' + text.slice(start, end) + ')', {}, {timeout:500});
    if (key === 'u') resolveChunk = fn; else resolveCSS = fn;
  }
}
function findAssets(text, base, type) {
  if (type === 'html') {
    for (const match of text.matchAll(/(?:src|href|poster)="([^"<>]+)"/g)) {
      if (/\.(css|js|png|jpe?g|svg|webp|ico|woff2?|mp4|webm)(?:\?|$)/i.test(match[1])) enqueue(match[1], base);
    }
  }
  if (type === 'css') {
    for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) enqueue(match[1], base);
  }
  if (type === 'js') {
    if (base.includes('/webpack-')) chunkResolvers(text);
    for (const match of text.matchAll(/\.e\(\s*(\d+)\s*\)/g)) chunkIDs.add(Number(match[1]));
    for (const match of text.matchAll(/["'`]((?:\/harness\/|\/fonts\/)[^\s"'`]+\.(?:svg|png|webp|jpe?g|woff2?|mp4|webm))["'`]/g)) enqueue(match[1], base);
  }
}
async function download(url) {
  const u = new URL(url);
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') + (u.pathname.endsWith('/') ? 'index.html' : '');
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep)) throw new Error('Invalid download path');
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(target), {recursive:true});
    const existing = await fs.readFile(target).catch(() => null);
    if (!existing?.equals(bytes)) await fs.writeFile(target, bytes);
    const text = bytes.toString('utf8');
    const type = u.pathname.endsWith('/') ? 'html' : u.pathname.endsWith('.css') ? 'css' : u.pathname.endsWith('.js') ? 'js' : '';
    if (type) findAssets(text, url, type);
    files.push({url, path:rel.replaceAll('\\','/'), bytes:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  } catch (error) { failures.push({url,error:error.message}); }
}
for (const locale of ['', '/en']) {
  for (const page of ['/harness/', '/harness/privacy/', '/harness/terms-of-use/']) {
    enqueue(locale + page); enqueue(locale + page + 'index.txt');
  }
}
for (const name of ['feat-plugins-zh.webp','feat-plugins-en.webp','feat-trace-zh.webp','feat-trace-en.webp','qr-wechat.png','deepseek-harness-social.jpg']) enqueue('/harness/images/' + name);
let count = 0;
while (pending.length) {
  const batch = pending.splice(0, 6);
  await Promise.all(batch.map(download));
  if (resolveChunk) for (const id of chunkIDs) {
    const ref = resolveChunk(id);
    if (ref && !ref.includes('undefined')) enqueue('/_next/' + ref);
  }
  if (++count % 5 === 0) console.log(`Downloaded ${files.length}; queued ${pending.length}`);
}
// Preserve the read-only country lookup used by the original download menu.
try {
  const response = await fetch('https://chat.deepseek.com/api/v0/ip_to_country_code', {signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  // Only the country code is needed by the menu; do not retain the downloader's IP.
  if (data.data?.biz_data) delete data.data.biz_data.ip;
  await fs.mkdir(path.join(root, '__mirror__'), {recursive:true});
  await fs.writeFile(path.join(root, '__mirror__/country.json'), JSON.stringify(data));
} catch (error) { failures.push({url:'country lookup',error:error.message}); }
await fs.writeFile(path.join(root,'download-manifest.json'), JSON.stringify({origin,capturedAt:new Date().toISOString(),files,failures},null,2));
console.log(JSON.stringify({downloaded:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),failures},null,2));
if (failures.length) process.exitCode = 1;
