async (page) => {
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');
 await page.waitForTimeout(1800);
 const reject=page.getByRole('button',{name:'Reject All',exact:true});
 if(await reject.isVisible())await reject.click();
 await page.evaluate(()=>window.lenis?.stop());
 const data=await page.evaluate(()=>({
  images:[...document.images].map(e=>({src:e.getAttribute('src'),name:e.closest('[data-framer-name]')?.dataset.framerName,alt:e.alt,rect:e.getBoundingClientRect().toJSON()})),
  icons:[...document.querySelectorAll('svg')].map(e=>({svg:e.outerHTML,name:e.closest('[data-framer-name]')?.dataset.framerName})),
  animations:[...document.querySelectorAll('canvas')].map(e=>({rect:e.getBoundingClientRect().toJSON(),parents:[e.parentElement,e.parentElement.parentElement,e.parentElement.parentElement.parentElement].map(p=>({name:p.dataset.framerName,class:p.className,rect:p.getBoundingClientRect().toJSON()}))})),
  sections:[...document.querySelectorAll('#main>.framer-jTcP9>div')].map(e=>({name:e.dataset.framerName,rect:e.getBoundingClientRect().toJSON()})),
 }));
 const promise=page.waitForEvent('download');
 await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='source-details.json';a.click();},data);
 await(await promise).saveAs('output/playwright/source-details.json');
 await page.getByText('Products',{exact:true}).last().hover();
 await page.waitForTimeout(600);
 await page.screenshot({path:'output/playwright/source-desktop-menu.png'});
 await page.mouse.move(30,800);
 await page.evaluate(()=>window.scrollTo({top:4750,behavior:'instant'}));
 await page.waitForTimeout(4500);
 await page.screenshot({path:'output/playwright/source-trust-late.png'});
 await page.setViewportSize({width:390,height:844});
 await page.reload();
 await page.waitForTimeout(1600);
 await page.evaluate(()=>window.lenis?.stop());
 await page.screenshot({path:'output/playwright/source-mobile-fresh.png'});
 return {images:data.images.length,svg:data.icons.length,canvases:data.animations};
}
