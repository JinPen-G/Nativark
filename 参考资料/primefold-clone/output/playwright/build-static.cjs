// One-time mechanical conversion. The original mirror is never overwritten.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('C:/Users/Penn/AppData/Local/npm-cache/_npx/beb367dfa21eb3f5/node_modules/esbuild');
const root = path.resolve(__dirname, '../..');
const entry = path.join(root, 'assets/framerusercontent.com/sites/1C0xbF1SKgnQ0Z1nYjvdiv/script_main.D647xVyo.mjs');
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]); }
const files = walk(path.join(root,'assets'));
const resources = {};
for (const file of files.filter(x=>/\.(?:framercms|json)$/.test(x))) {
  resources[path.relative(root,file).replaceAll('\\','/')] = fs.readFileSync(file).toString('base64');
}
const boot = `(() => {
  'use strict';
  const resources = ${JSON.stringify(resources)};
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const address = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(address, document.baseURI);
    const assetPath = url.pathname.slice(url.pathname.indexOf('/assets/') + 1).replace('/cms/', '/modules/');
    if (resources[assetPath]) {
      const bytes = Uint8Array.from(atob(resources[assetPath]), c => c.charCodeAt(0));
      const type = assetPath.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      return Promise.resolve(new Response(bytes, {status:200, headers:{'Content-Type':type}}));
    }
    // This is a local visual template, not the original company's live lead collector.
    if (/^(api\\.framer\\.com|events\\.framer\\.com|api\\.hsforms\\.com)$/.test(url.hostname)) {
      return Promise.resolve(new Response('{}', {status:200, headers:{'Content-Type':'application/json'}}));
    }
    return nativeFetch(input, options);
  };
  try { navigator.sendBeacon = () => false; } catch (_) {}
  document.addEventListener('submit', event => {
    if (!(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.target.reportValidity()) return;
    let notice = event.target.querySelector('[data-static-form-note]');
    if (!notice) {
      notice = document.createElement('p');
      notice.dataset.staticFormNote = '';
      notice.setAttribute('role','status');
      notice.style.cssText = 'font:inherit;font-size:14px;line-height:1.5;color:inherit;margin:12px 0 0';
      event.target.appendChild(notice);
    }
    notice.textContent = 'Preview only — no information has been sent.';
  }, true);
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href?.startsWith('./#') || href?.startsWith('/#')) {
      event.preventDefault();event.stopImmediatePropagation();
      const hash = href.slice(href.indexOf('#'));
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (target) {
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (window.lenis) window.lenis.scrollTo(target, {immediate:reduced});
        else target.scrollIntoView({behavior:reduced?'instant':'smooth'});
      }
    }
  }, true);
})();`;
(async () => {
  const result = await esbuild.build({entryPoints:[entry], bundle:true, write:false, format:'iife', platform:'browser', target:'es2022', minify:true, legalComments:'inline',
    plugins:[{name:'portable-mirror-paths',setup(build){
      build.onLoad({filter:/\.(?:mjs|js)$/}, args=>{
        let contents=fs.readFileSync(args.path,'utf8');
        // CMS modules use absolute URL bases. Make those bases portable first.
        contents=contents.replace(/new URL\(([^,]+),([`"'])http:\/\/localhost:8137\/([^`"']+)\2\)/g,
          (_,relative,quote,base)=>`new URL(${relative},new URL(${quote}./${base}${quote},document.baseURI).href)`);
        contents=contents.replaceAll('http://localhost:8137/assets/','./assets/');
        return {contents,loader:'js'};
      });
    }}]});
  const runtime = boot + '\n' + result.outputFiles[0].text;
  fs.writeFileSync(path.join(root,'assets/primefold-static.js'), runtime);
  let html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  // Keep SSR content, CSS, hydration data and the original fonts/artwork exactly.
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,tag=>{
    if(tag.includes('type="framer/handover"')) return tag;
    if(tag.includes('data-framer-appear-animation=')) return tag;
    return '';
  });
  html=html.replace(/<link\b[^>]*(?:rel="modulepreload"|rel="preconnect")[^>]*>/gi,'');
  html=html.replaceAll('http://localhost:8137/assets/','./assets/');
  html=html.replace(/<meta\b[^>]*name="framer-search-index(?:-fallback)?"[^>]*>/gi,'');
  html=html.replace('</body>','<!-- Compiled original interactions, portable classic script; no development server required. -->\n<script defer src="./assets/primefold-static.js"></script>\n</body>');
  html=html.replace('<!-- Made in Framer · framer.com ✨ -->','<!-- Portable static edition. Original copy, artwork, styling and compiled interactions preserved. -->');
  fs.writeFileSync(path.join(root,'static.html'),html);
  console.log(JSON.stringify({htmlBytes:Buffer.byteLength(html),runtimeBytes:Buffer.byteLength(runtime),inlineResources:Object.keys(resources).length,originalPreserved:fs.existsSync(path.join(root,'index.html'))}));
})();
