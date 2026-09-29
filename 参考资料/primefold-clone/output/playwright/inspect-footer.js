async (page) => {
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');
 await page.waitForTimeout(700);
 await page.evaluate(()=>{window.lenis?.stop();scrollTo({top:7400,behavior:'instant'});});
 await page.waitForTimeout(1000);
 return await page.locator('footer').evaluate(e=>{
  const info=n=>({cls:n.className,y:n.getBoundingClientRect().top+scrollY,h:n.getBoundingClientRect().height,padding:getComputedStyle(n).padding,gap:getComputedStyle(n).gap,position:getComputedStyle(n).position,transform:getComputedStyle(n).transform,bg:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).border,radius:getComputedStyle(n).borderRadius});
  return {footer:info(e),children:[...e.children].map(n=>({info:info(n),children:[...n.children].map(info)})),masks:[...e.querySelectorAll('*')].filter(n=>getComputedStyle(n).maskImage.startsWith('url')).map(n=>({mask:getComputedStyle(n).maskImage,parent:n.parentElement.outerHTML.slice(0,500)})),wordmark:[...e.querySelectorAll('img')].map(n=>({src:n.src,info:info(n),parents:[n.parentElement,n.parentElement.parentElement,n.parentElement.parentElement.parentElement].map(info)}))};
 });
}
