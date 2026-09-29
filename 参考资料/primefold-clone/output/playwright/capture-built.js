async (page) => {
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/source/');
 await page.waitForTimeout(800);
 const reject=page.locator('[data-cookie-action="reject"]');
 if(await reject.isVisible()) await reject.click();
 await page.locator('#hero-tab-0').hover();
 await page.getByRole('button',{name:'Products',exact:true}).hover();
 await page.waitForTimeout(350);
 await page.screenshot({path:'output/playwright/built-desktop-0.png'});
 await page.keyboard.press('Escape');
 await page.evaluate(()=>document.activeElement.blur());
 await page.mouse.move(5,5);
 const layout=await page.evaluate(()=>[...document.querySelectorAll('h1,h2,.product-grid,.flow-card,.quote-card,.teams-track,.trust-visual,.outcome-grid,.cta-card,footer')].slice(0,30).map(e=>({selector:e.className,text:e.textContent.slice(0,65),rect:e.getBoundingClientRect().toJSON(),font:getComputedStyle(e).fontFamily,size:getComputedStyle(e).fontSize})));
 for(const y of [1250,2250,3150,3950,4750,5550,6250,7000]){
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
  await page.waitForTimeout(y===5550?2200:800);
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
  await page.waitForTimeout(100);
  await page.screenshot({path:`output/playwright/built-desktop-${y}.png`});
 }
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://localhost:8137/source/');
 await page.waitForTimeout(600);
 await page.locator('#hero-tab-0').click();
 await page.evaluate(()=>document.activeElement.blur());
 await page.mouse.move(5,5);
 for(const y of [0,850,2200,3550,4600,5800,7100,8400]){
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
  await page.waitForTimeout(y===7100?2200:800);
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
  await page.waitForTimeout(100);
  await page.screenshot({path:`output/playwright/built-mobile-${y}.png`});
 }
 return {layout,overflow:await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}))};
}
