async(page)=>{
 const box=await page.evaluate(()=>{let e=[...document.querySelectorAll('h3')].find(e=>e.textContent==='Asset manager');while(e&&e.dataset.framerName!=='Variant 1')e=e.parentElement;return e.getBoundingClientRect().toJSON();});
 await page.screenshot({path:'output/playwright/source-team-detail.png',clip:{x:box.x,y:box.y,width:box.width,height:box.height}});
 return box;
}
