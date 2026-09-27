async(page)=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://localhost:8137/');await page.waitForTimeout(800);
 await page.mouse.move(5,5);
 await page.evaluate(()=>{document.activeElement.blur();window.lenis?.stop();scrollTo({top:0,behavior:'instant'});});
 await page.waitForTimeout(300);
 await page.screenshot({path:'output/playwright/source-mobile-fresh.png'});
 for(const y of [850,2200,3550,4600,5800,7100,8400]){
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
  await page.waitForTimeout(y===7100?2200:800);
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
  await page.waitForTimeout(100);
  await page.screenshot({path:`output/playwright/source-mobile-${y}.png`});
 }
 return {height:await page.evaluate(()=>document.documentElement.scrollHeight)};
}
