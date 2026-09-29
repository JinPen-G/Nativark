async(page)=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');await page.waitForTimeout(1000);
 await page.mouse.move(5,5);
 await page.evaluate(()=>{document.activeElement.blur();window.lenis?.stop();scrollTo({top:0,behavior:'instant'});});
 const positions=[];
 for(const y of [1250,2250,3150,3950,4750,5550,6250,7000]){
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
  await page.waitForTimeout(y===5550?2200:800);
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);
  await page.waitForTimeout(100);
  await page.screenshot({path:`output/playwright/source-desktop-${y}.png`});
  positions.push(await page.evaluate(()=>scrollY));
 }
 return {positions};
}
