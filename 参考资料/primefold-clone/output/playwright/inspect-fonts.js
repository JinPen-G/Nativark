async(page)=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('http://localhost:8137/');await page.waitForTimeout(1000);await page.mouse.move(650,35);await page.waitForTimeout(300);
 const items=await page.evaluate(()=>[...document.querySelectorAll('p,a')].filter(e=>['Products','Experience Intelligence'].includes(e.textContent.trim())&&e.getBoundingClientRect().width&&e.getBoundingClientRect().top<150).map(e=>{const s=getComputedStyle(e);return{text:e.textContent,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,spacing:s.letterSpacing,rect:e.getBoundingClientRect().toJSON()};}));
 const faces=await page.evaluate(()=>[...document.fonts].filter(f=>f.family.includes('Favorit')).map(f=>({family:f.family,weight:f.weight,status:f.status})));
 const metrics=await page.evaluate(()=>[...document.querySelectorAll('span')].filter(e=>getComputedStyle(e).fontSize==='80px').slice(0,1).map(e=>{let items=[];for(let i=0;i<6&&e;i++,e=e.parentElement){const s=getComputedStyle(e);items.push({tag:e.tagName,font:s.fontFamily,size:s.fontSize,line:s.lineHeight,gap:s.gap,weight:s.fontWeight,display:s.display,align:s.alignItems,style:e.getAttribute('style'),rect:e.getBoundingClientRect().toJSON()});}return items;}));
 return {items,faces,metrics};
}
