async(page)=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://localhost:8137/source/');
 await page.evaluate(()=>scrollTo({top:4600,behavior:'instant'}));
 await page.waitForTimeout(1000);
 await page.evaluate(()=>{
  document.querySelector('.teams-track').scrollTo({left:0,behavior:'instant'});
  scrollTo({top:4600,behavior:'instant'});
 });
 await page.waitForTimeout(200);
 const card=page.locator('.team-card').first();
 await card.screenshot({path:'output/playwright/built-team-detail.png'});
 return await card.evaluate(e=>e.getBoundingClientRect().toJSON());
}
