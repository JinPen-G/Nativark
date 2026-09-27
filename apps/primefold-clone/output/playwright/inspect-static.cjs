const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '../..');
function walk(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]); }
for (const file of walk(path.join(base,'assets')).filter(x=>/\.(?:mjs|js)$/.test(x))) {
  const s=fs.readFileSync(file,'utf8');
  const imports=[...s.matchAll(/(?:from|import\()\s*['"`]([^'"`]+)['"`]/g)].map(m=>m[1]).filter(x=>!x.startsWith('.'));
  const urls=[...new Set(s.match(/https?:[^\s'"`<>]+/g)||[])].filter(x=>!x.includes('localhost:8137'));
  if(imports.length||urls.some(x=>/cms|framer|hubspot/.test(x))) console.log(path.basename(file), JSON.stringify({imports, urls:urls.slice(0,8)}));
  for (const term of ['NqWsmt1gV','/cms/','import.meta.url']) {
    const i=s.indexOf(term);if(i>=0) console.log(term,path.basename(file),s.slice(Math.max(0,i-180),i+260));
  }
}
console.log('CMS sizes',walk(path.join(base,'assets')).filter(x=>x.endsWith('.framercms')).map(file=>({file:path.relative(base,file),bytes:fs.statSync(file).size})));
