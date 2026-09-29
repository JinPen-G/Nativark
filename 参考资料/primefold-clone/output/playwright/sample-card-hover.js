async(page)=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://localhost:8137/');await page.waitForTimeout(1400);await page.evaluate(()=>{window.lenis?.stop();scrollTo({top:2300,behavior:'instant'});});
 const reject=page.getByRole('button',{name:'Reject All',exact:true});if(await reject.isVisible())await reject.click();
 const data=[];
 for(const [index,x] of [[0,250],[1,700],[2,1150]]){
  await page.mouse.move(x,470);await page.waitForTimeout(700);
  await page.screenshot({path:`output/playwright/ref-hover-${index}.png`});
  data.push(await page.evaluate(()=>[...document.querySelectorAll('[data-framer-name]')].filter(e=>e.getBoundingClientRect().top>150&&e.getBoundingClientRect().bottom<850).map(e=>({name:e.dataset.framerName,cls:e.className,text:e.textContent.slice(0,70),transform:getComputedStyle(e).transform,opacity:getComputedStyle(e).opacity,rect:e.getBoundingClientRect().toJSON()})).filter(e=>e.transform!=='none'||e.opacity!=='1')));
 }
 return data;
}
