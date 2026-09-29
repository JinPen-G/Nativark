async(page)=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');await page.waitForTimeout(1600);
 await page.evaluate(()=>window.lenis?.stop());await page.mouse.move(5,5);
 const results=[];
 for(const y of [0,700,1300,1800,2300,3800,4500,5200,6200,7200]){
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
  const samples=[];
  for(const t of [0,100,500,1300]){
   if(t)await page.waitForTimeout(t);
   samples.push(await page.evaluate(()=>({y:scrollY,nodes:[...document.querySelectorAll('[data-framer-name]')].filter(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&r.width>20&&r.height>20}).map(e=>{const s=getComputedStyle(e);return {name:e.dataset.framerName,cls:e.className,text:e.textContent.slice(0,45),transform:s.transform,opacity:s.opacity,filter:s.filter,animations:e.getAnimations().map(a=>({state:a.playState,frames:a.effect?.getKeyframes()?.slice(0,2)}))};}).filter(e=>e.transform!=='none'||e.opacity!=='1'||e.animations.length)})));
  }
  results.push({y,samples});
  await page.screenshot({path:`output/playwright/motion-ref-${y}.png`});
 }
 const download=page.waitForEvent('download');
 await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)]));a.download='motion-original.json';a.click();},results);
 await(await download).saveAs('output/playwright/motion-original.json');
 return results.map(e=>({y:e.y,movingNames:[...new Set(e.samples.flatMap(s=>s.nodes.map(e=>e.name)))]}));
}
