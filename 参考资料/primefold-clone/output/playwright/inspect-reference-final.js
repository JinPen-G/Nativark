async (page) => {
 const inspect=()=>[...document.querySelectorAll('h1,h2,h3,p')].filter(e=>['Experience Intelligence','More coming in 2027','Turn questions into better decisions.','More units sold with data-driven color selection.','Seven touchpoints, one picture of the market . This clarity got us from zero to 150 customers.'].includes(e.textContent.trim().replace(/\s+/g,' '))).map(e=>({text:e.textContent,parents:[e,e.parentElement,e.parentElement.parentElement,e.parentElement.parentElement.parentElement].map(n=>({tag:n.tagName,cls:n.className,rect:n.getBoundingClientRect().toJSON(),font:getComputedStyle(n).font,padding:getComputedStyle(n).padding,gap:getComputedStyle(n).gap,display:getComputedStyle(n).display}))}));
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://localhost:8137/');
 await page.waitForTimeout(1000);
 await page.evaluate(()=>window.lenis?.stop());
 await page.evaluate(()=>scrollTo({top:2500,behavior:'instant'}));
 await page.waitForTimeout(1200);
 const mobile=await page.evaluate(inspect);
 await page.screenshot({path:'output/playwright/reference-mobile-products.png'});
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');
 await page.waitForTimeout(1000);
 await page.evaluate(()=>{window.lenis?.stop();scrollTo({top:5900,behavior:'instant'});});
 await page.waitForTimeout(1500);
 const desktop=await page.evaluate(inspect);
 await page.evaluate(()=>scrollTo({top:10000,behavior:'instant'}));
 await page.waitForTimeout(600);
 const social=await page.locator('footer').evaluate(e=>[...e.querySelectorAll('a')].map(a=>({href:a.href,html:a.outerHTML})).filter(a=>/linkedin|twitter|x.com|mailto:/.test(a.href)));
 return {mobile,desktop,social};
}
