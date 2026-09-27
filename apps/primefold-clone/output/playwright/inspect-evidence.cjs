const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync('output/playwright/source-evidence.json','utf8'));
const short = s => s?.startsWith('data:') ? '[data SVG]' : s?.replace('http://localhost:8137/','');
console.log('BACKGROUND',data.backgrounds.map(x=>({name:x.name,bg:x.bg,rect:x.rect})));
console.log('HEADINGS',data.headings.map(x=>({text:x.text,images:x.images.map(i=>short(i.src))})));
console.log('NAMED',data.named.map(x=>({name:x.name,text:x.text,images:x.images.map(i=>short(i.src))})));
console.log('LINKS',data.links);
for(const entry of fs.readdirSync('assets/framerusercontent.com/assets')){
 if(!entry.endsWith('.json'))continue;
 try{const j=JSON.parse(fs.readFileSync(path.join('assets/framerusercontent.com/assets',entry),'utf8'));console.log('JSON',entry,j.nm,j.w,j.h,j.fr,j.layers?.slice(0,25).map(x=>x.nm));}catch{}
}
