async (page) => {
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');
 await page.waitForTimeout(900);
 await page.evaluate(()=>window.lenis?.stop());
 const fonts=await page.evaluate(()=>[...document.querySelectorAll('h1,h2,h3,.framer-19zmlkx')].filter(e=>e.getBoundingClientRect().width).map(e=>({text:e.textContent.slice(0,160),font:getComputedStyle(e).fontFamily,size:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight,spacing:getComputedStyle(e).letterSpacing,rect:e.getBoundingClientRect().toJSON()})));
 await page.evaluate(()=>scrollTo({top:7200,behavior:'instant'}));
 await page.waitForTimeout(800);
 const icons=await page.evaluate(()=>[...document.querySelectorAll('svg')].map(e=>({svg:e.outerHTML,name:e.closest('[data-framer-name]')?.dataset.framerName})).filter(i=>['XLogo','LinkedinLogo','EnvelopeSimple'].includes(i.name)));
 const promise=page.waitForEvent('download');
 await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='original-measurements.json';a.click();},{fonts,icons});
 await(await promise).saveAs('output/playwright/original-measurements.json');
 return {fonts,iconNames:icons.map(i=>i.name)};
}
