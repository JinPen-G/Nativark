async (page) => {
 const result = await page.evaluate(()=>[...document.querySelectorAll('p,div,span')].filter(e=>e.textContent.replace(/\s/g,'')==='150customers' && e.children.length<20).slice(-12).map(e=>{const s=getComputedStyle(e);return {tag:e.tagName,cls:e.className,rect:e.getBoundingClientRect().toJSON(),font:s.fontFamily,size:s.fontSize,line:s.lineHeight,space:s.letterSpacing,weight:s.fontWeight,wrap:s.whiteSpace,child:e.firstElementChild?getComputedStyle(e.firstElementChild).font:null};}));
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{window.lenis?.stop();scrollTo({top:7100,behavior:'instant'});});
 await page.waitForTimeout(2200);
 await page.screenshot({path:'output/playwright/source-mobile-7100.png'});
 const mobile=await page.evaluate(()=>[...document.querySelectorAll('p,div,span')].filter(e=>e.textContent==='150 customers' && e.children.length<20).slice(-12).map(e=>{const s=getComputedStyle(e);return {tag:e.tagName,cls:e.className,rect:e.getBoundingClientRect().toJSON(),font:s.fontFamily,size:s.fontSize,line:s.lineHeight,space:s.letterSpacing,weight:s.fontWeight,wrap:s.whiteSpace};}));
 return {desktop:result,mobile};
}
