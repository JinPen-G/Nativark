const fs=require('fs');const path=require('path');
const dir='assets/framerusercontent.com/sites/1C0xbF1SKgnQ0Z1nYjvdiv';
const patterns=[/Everything answers/g,/Built for every team/g,/whileInView/g,/scrollTransform/g,/rotateX/g,/scrollYProgress/g,/1ZEqVNG/g,/xNm1ok67/g,/duration:\.?[0-9]+/g];
for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.mjs'))){
 if(/framer\.|motion\.|react\./.test(file))continue;
 const text=fs.readFileSync(path.join(dir,file),'utf8');
 let count=0;
 for(const p of patterns){for(const m of text.matchAll(p)){
  if(count++>=12)break;
  console.log(file,m.index,text.slice(Math.max(0,m.index-260),m.index+380));
 }}
}
