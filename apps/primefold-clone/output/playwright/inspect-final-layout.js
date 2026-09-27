async(page)=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');await page.waitForTimeout(800);
 await page.mouse.move(5,5);
 await page.evaluate(()=>{window.lenis?.stop();scrollTo({top:5550,behavior:'instant'});});await page.waitForTimeout(1800);
 const data=await page.evaluate(()=>({metrics:[...document.querySelectorAll('div,span,p')].filter(e=>e.textContent.includes('150')&&e.textContent.length<100).map(e=>{const s=getComputedStyle(e);return{text:e.textContent,font:s.font,space:s.letterSpacing,rect:e.getBoundingClientRect().toJSON(),html:e.outerHTML.slice(0,1200)};}),heads:[...document.querySelectorAll('h2')].filter(e=>e.getBoundingClientRect().width).map(e=>({text:e.textContent,y:e.getBoundingClientRect().top+scrollY})),scrollY}));
 return data;
}
