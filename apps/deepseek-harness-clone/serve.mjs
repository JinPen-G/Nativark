// Hosts the captured template and applies Rental OS header/Hero branding in responses.
// Original downloaded files, Next.js navigation and public-country snapshot are retained.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandResponse } from './rentalos/brand.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8138);
const types = {'.html':'text/html; charset=utf-8','.txt':'text/x-component; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon','.mp4':'video/mp4','.webm':'video/webm'};
const adapter = `(() => {
  function localURL(value) {
    const url = String(value);
    return url.startsWith('https://chat.deepseek.com/api/v0/ip_to_country_code') ? '/__mirror__/country.json' : value;
  }
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url && localURL(url) !== url) return nativeFetch(localURL(url), init);
    return nativeFetch(input, init);
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) { return nativeOpen.call(this, method, localURL(url), ...args); };
})();`;
const server = http.createServer(async (req,res) => {
  let pathname; try {pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);} catch {res.writeHead(400).end();return;}
  if (pathname === '/' || pathname === '/index.html') {res.writeHead(302,{Location:'/harness/'}).end();return;}
  if (pathname === '/__mirror__/local.js') {res.writeHead(200,{'Content-Type':types['.js'],'Cache-Control':'no-store'}).end(adapter);return;}
  const isPage=/^\/(en\/)?harness(?:\/(privacy|terms-of-use))?\/?$/.test(pathname);
  const isRSC=req.headers.rsc === '1';
  const pagePath=isPage ? pathname.replace(/\/$/,'') + '/' + (isRSC?'index.txt':'index.html') : pathname;
  const filename=path.resolve(root,'.'+pagePath+(!isPage&&pathname.endsWith('/')?'index.html':''));
  if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try {
    let bytes=await fs.readFile(filename);
    bytes=brandResponse(filename, bytes);
    const type=types[path.extname(filename)]||'application/octet-stream';
    if(filename.endsWith('.html')) bytes=Buffer.from(bytes.toString('utf8').replace('<head>','<head><script src="/__mirror__/local.js"></script>'));
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:bytes);
  } catch {
    // Product downloads are external to the requested Harness landing page.
    if (/^\/(en\/)?download\/?$/.test(pathname)) {res.writeHead(302,{Location:'https://www.deepseek.com'+pathname}).end();return;}
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Not downloaded: '+pathname);
  }
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`DeepSeek Harness mirror: http://127.0.0.1:${port}/harness/`));
