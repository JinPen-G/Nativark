async(page)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('http://localhost:8137/');await page.waitForTimeout(1000);await page.mouse.move(5,5);
 await page.evaluate(()=>{window.lenis?.stop();scrollTo({top:4600,behavior:'instant'});});await page.waitForTimeout(1000);await page.evaluate(()=>scrollTo({top:4600,behavior:'instant'}));
 const result=await page.evaluate(()=>[...document.querySelectorAll('h3')].filter(e=>e.textContent==='Asset manager').map(e=>{let nodes=[];for(let i=0;i<6&&e;i++,e=e.parentElement){const s=getComputedStyle(e);nodes.push({text:e.innerText?.slice(0,120),name:e.dataset.framerName,rect:e.getBoundingClientRect().toJSON(),font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,height:s.height,width:s.width,padding:s.padding,transform:s.transform});}return nodes;}));
 await page.mouse.click(276,360);await page.waitForTimeout(800);await page.screenshot({path:'output/playwright/source-mobile-teams-first.png'});
 const text=await page.evaluate(()=>[...document.querySelectorAll('p')].filter(e=>e.textContent.startsWith('Talk to your portfolio.')).map(e=>({rect:e.getBoundingClientRect().toJSON(),font:getComputedStyle(e).fontFamily,size:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight,width:getComputedStyle(e).width})));
 return {result,text};
}
