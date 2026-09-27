async (page) => {
 await page.setViewportSize({width:390,height:844});
 await page.goto('http://localhost:8137/');
 await page.waitForTimeout(1000);
 return await page.evaluate(()=>{
  const info=e=>({cls:e.className,name:e.dataset.framerName,text:e.textContent.slice(0,90),y:e.getBoundingClientRect().top,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,pad:getComputedStyle(e).padding,gap:getComputedStyle(e).gap});
  const section=document.querySelector('.framer-o73l5v');
  return {tree:[...section.children].map(e=>({info:info(e),children:[...e.children].map(c=>({info:info(c),children:[...c.children].map(d=>({info:info(d),children:[...d.children].map(info)}))}))})),footer:[...document.querySelector('footer').children].map(info)};
 });
}
