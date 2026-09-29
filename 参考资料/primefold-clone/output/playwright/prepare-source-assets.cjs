// One-time mechanical asset extraction. This is NOT part of the website runtime.
const fs = require('fs');
const path = require('path');
const out = 'source/assets';
for (const dir of ['images','icons','fonts','animations']) fs.mkdirSync(`${out}/${dir}`, {recursive:true});
const data = JSON.parse(fs.readFileSync('output/playwright/source-details.json','utf8'));
const images = 'assets/framerusercontent.com/images/';
const mapping = {
 'hero-platform.webp':'RAjs2AsxMPYWQK7qgQzwPegjUEI__q91f83962.webp',
 'hero-experience.webp':'whU1ew3cUmTlwn8jZq7aYOjcWOU__q27d797a6.webp',
 'hero-realestate.webp':'0ludMTRIYsIsZjBXbYoAOYh09IY__q61ede8e4.webp',
 'platform.svg':'Ok2FqoeufFP2awsp0MRNxJXTDA__qc4985025.svg',
 'platform-white.svg':'0ngLiiCSe7c81sENFiXDCxUe8Ew__qc4985025.svg',
 'xi.svg':'8Xe3QbAF8z173WRaVrPeURWrGc__qc4985025.svg',
 'ri.svg':'Vmatt47vXW6vUstSo8WnUvQwvRQ__qc4985025.svg',
 'ci.svg':'FKdTY48jmzOKCr6FVHOYD8MSv7s__qc4985025.svg',
 'survey.png':'U0tJJ7Y3amMDQd4StUat5cOK8uk__q0d633df7.png',
 'property.webp':'0nTcgouZiu10WBq79OBdBOz9v8__q89d40336.webp',
 'lease.png':'yhaWJ4eSadpaWQiwRKmrlQa99sY__qad86b664.png',
 'quote-dirts.jpg':'9Yky6fB1AoenMkNm8rzRwLJxM8__q0bf481c4.jpg',
 'quote-nas.jpg':'OCJYK6agr32RKk3h6WGSSJgSB0g__q8a14924e.jpg',
 'quote-gainback.jpg':'qkL7CkFhbnE5G6A9rxHv5zbgxz8__qc23abb42.jpg',
 'quote-funke.jpeg':'07ZMtQS80wekxrvQAxnTtIZWXc__q2d7890bb.jpeg',
 'dirts.png':'mlevCnZoqAApeTSZWClq74jYCg__qe5f14ca8.png',
 'nas.png':'0I7dW2NSk2zVnHLMvfACsc1BIr8__q67e12c51.png',
 'gainback.svg':'vBdLAfXU5G3G8FMre5KLbUkCzWc__qe030a685.svg',
 'funke.webp':'zBz0VomWfjQ5l9E8sVDczIDkkM__q07e1dd9d.webp',
 'team-asset.webp':'RIjH19JJ8DvQamX9HDKg7VWbBM__q19128c87.webp',
 'team-cx.webp':'gKDbEEFrzbOGZRjHe04RbEaotM__q016902e1.webp',
 'team-hr.webp':'JGTzpslef9rSgfzJqV3ZOBMFwQ__q016902e1.webp',
 'team-marketing.webp':'R6Jj9Z2JPALtAXaI6edzv92aGE__q19128c8a.webp',
 'team-product.webp':'TxwVY1FIAJFI0frWJNMxfQCJecU__q19128c87.webp',
 'outcome-dirts.png':'vukJGGeDQ72ugU8BMCw9S7b0NI8__qd3ecb8bc.png',
 'outcome-gainback.jpeg':'2YKiPQOWTotKpViisGGHGQbghrM__q9169db07.jpeg',
 'outcome-funke.jpg':'NS0Wgwn5twaEyiw0qOiX49499Y__q7955bfcd.jpg',
 'wordmark.svg':'L5IVS7Cn2X7mzYJB2j1MVEECRKk__q07e1de15.svg',
};
for(const [name,file] of Object.entries(mapping)) fs.copyFileSync(images+file,`${out}/images/${name}`);
const logos = ['ZsKdZVlAf876Rrwiwazp9C1blE','nlOVPK5FHG0ndiVB0ULwmrzrhGE','gw627qb02zAYoAJDKu7MRKA78w','NpVlmnBuOYAIBUDlryGGeWScA','v8lxFvYwzTMiWQaeYGjc7AmMPGc','Ya6ALhQSDRAfUJyHiI9cmYGjdQ','pcuIABtcyl9aukVdDp5BTRem8','agM8WPiTSSNhSUuc3kD4hKxOVIk','GTNtezbGW5utWxjO3br6opPnEXg','zY5XhJUc3an2aLvZT8wHzSzTQ'];
logos.forEach((name,i)=>fs.copyFileSync(images+name+'__qb8779e87.svg',`${out}/images/client-${i+1}.svg`));
const seen = new Set();let index=0;
for(const item of data.images.filter(x=>x.src?.startsWith('data:image/svg+xml'))){
 if(seen.has(item.src))continue;seen.add(item.src);
 const raw=item.src.slice(item.src.indexOf(',')+1);
 const svg=item.src.includes(';base64,')?Buffer.from(raw,'base64').toString():decodeURIComponent(raw);
 const name=item.rect.width===124?'logo.svg':`image-icon-${++index}.svg`;
 fs.writeFileSync(`${out}/icons/${name}`,svg);
 console.log('ICON',name,item.name,item.rect.width,item.rect.height);
}
data.icons.forEach((item,i)=>{
 const svg=item.svg.replace(/<use[^>]*href="#([^"]+)"[^>]*><\/use>/g,(_,id)=>{
  const template=data.icons.find(x=>x.svg.includes(`id="${id}"`));
  return template?template.svg.replace(/id="[^"]*"/g,''):'';
 });
 fs.writeFileSync(`${out}/icons/inline-${i}.svg`,svg);
 console.log('SVG',i,item.name,svg.slice(0,110));
});
const anim = {flow:'moPGmwTvnuXuTyKte2PPRrHQg8', 'flow-mobile':'OknllgUhooQfTetYAC4GFk7dak', trust:'HY16h57JG9iHUXsmkr9vgGV0A', 'experience-hover':'1ZEqVNGcLr5LXnzhYZ2dZA8Wl7I', 'property-hover':'xNm1ok67qiSXrtlhAImlRlSghE'};
for(const [name,id] of Object.entries(anim))fs.copyFileSync(`assets/framerusercontent.com/assets/${id}.json`,`${out}/animations/${name}.json`);
const html=fs.readFileSync('index.html','utf8');
const faces=[...html.matchAll(/@font-face\s*\{[^}]+\}/g)].map(x=>x[0]);
const wanted=[['Stack Sans Text','text'],['Stack Sans Headline','headline'],['Inter','inter'],['ABC Favorit Trial Book','favorit']];
for(const [family,name] of wanted){
 const face=faces.find(x=>x.includes(`"${family}"`)||x.includes(`'${family}'`));
 const candidates=faces.filter(x=>(x.includes(`"${family}"`)||x.includes(`'${family}'`))&&/font-weight:\s*(400|350)/.test(x));
 const latin=candidates.find(x=>x.includes('U+0000-00FF'))||face;
 const url=latin.match(/url\(["']?(http[^"')]+)/)[1];
 fs.copyFileSync(url.replace('http://localhost:8137/',''),`${out}/fonts/${name}.woff2`);
}
const shader=fs.readFileSync('assets/framerusercontent.com/sites/1C0xbF1SKgnQ0Z1nYjvdiv/GradientWave.DRWXYhPb.mjs','utf8').match(/fragment:`([\s\S]*?)`,propertyControls/)[1];
fs.mkdirSync('source/js',{recursive:true});
fs.writeFileSync('source/assets/animations/wave.frag',shader);
for(const file of fs.readdirSync(`${out}/icons`)) {
 if(!file.endsWith('.svg'))continue;
 const filename=`${out}/icons/${file}`;
 const raw=fs.readFileSync(filename,'utf8');
 if(!raw.includes('xmlns='))fs.writeFileSync(filename,raw.replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"'));
}
console.log('Assets extracted.');
