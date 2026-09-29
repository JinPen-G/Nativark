// Read-only visual diagnosis. Does not alter either site's implementation.
async (page) => {
  const original = !page.url().includes('/source/');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(original ? 'http://localhost:8137/' : 'http://localhost:8137/source/');
  await page.waitForTimeout(1200);
  await page.mouse.move(1400,120);
  const records = [];
  for (const y of [0,50,100,180,260,340,500]) {
    await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
    await page.waitForTimeout(350);
    records.push(await page.evaluate(original => {
      const tab=document.querySelector(original?'[id^="rmx-tab"]':'.hero-tab');
      const hero=document.querySelector(original?'.framer-1omteu6-container':'.hero');
      const content=document.querySelector(original?'.framer-moijkk':'.platform-area');
      const tr=tab.getBoundingClientRect(),cr=content.getBoundingClientRect();
      const probeY=Math.min(tr.bottom-3,Math.max(tr.top+3,cr.top+3));
      const hit=document.elementFromPoint(tr.left+20,probeY);
      return {
        scrollY,heroTop:hero.getBoundingClientRect().top,
        heroTransform:getComputedStyle(hero).transform,
        tab:{top:tr.top,bottom:tr.bottom},
        content:{top:cr.top,zIndex:getComputedStyle(content).zIndex,radius:getComputedStyle(content).borderTopLeftRadius},
        coveredPixels:Math.max(0,Math.min(tr.height,tr.bottom-cr.top)),
        probeY,hit:hit?{tag:hit.tagName,cls:hit.className,insideContent:content.contains(hit),insideTab:tab.contains(hit)}:null
      };
    },original));
    if ([0,100,180,260,340].includes(y)) await page.screenshot({path:`output/playwright/hero-cover-${original?'ref':'built'}-${y}.png`});
  }
  return {original,records};
}
