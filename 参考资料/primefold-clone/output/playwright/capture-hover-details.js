async(page)=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://localhost:8137/');await page.waitForTimeout(1000);await page.evaluate(()=>{window.lenis?.stop();scrollTo({top:2300,behavior:'instant'});});
 const data=[];
 for(const [name,selector] of [['xi','.framer-h3uyfc'],['ri','.framer-5g9054'],['ci','.framer-1bd834p']]){
  await page.locator(selector).first().hover();await page.waitForTimeout(1800);
  await page.screenshot({path:`output/playwright/ref-hover-${name}.png`});
  data.push({name,detail:await page.evaluate(()=>[...document.querySelectorAll('.framer-h3uyfc,.framer-5g9054,.framer-1bd834p,.framer-130b913-container,.framer-mk78ai-container,.framer-1yhgwq')].map(e=>({cls:e.className,rect:e.getBoundingClientRect().toJSON(),transform:getComputedStyle(e).transform,opacity:getComputedStyle(e).opacity}))) });
 }
 return data;
}
