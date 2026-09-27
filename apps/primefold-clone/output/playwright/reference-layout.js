async (page) => {
 const result={};
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.goto('http://localhost:8137/');
  await page.waitForTimeout(1000);
  await page.evaluate(()=>window.lenis?.stop());
  const layout=await page.evaluate(()=>{
   const rect=e=>({cls:e.className,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y+scrollY,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,padding:getComputedStyle(e).padding,gap:getComputedStyle(e).gap,flex:getComputedStyle(e).flexDirection});
   return {
    headings:[...document.querySelectorAll('h2')].filter(e=>e.getBoundingClientRect().x>=0&&e.getBoundingClientRect().x<innerWidth).map(e=>({text:e.textContent,rect:rect(e),parents:[e.parentElement,e.parentElement.parentElement,e.parentElement.parentElement.parentElement,e.parentElement.parentElement.parentElement.parentElement].map(rect),font:{family:getComputedStyle(e).fontFamily,size:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight,spacing:getComputedStyle(e).letterSpacing}})),
    product:[...document.querySelectorAll('a[href="./experience-intelligence"]')].filter(e=>e.getBoundingClientRect().width>250&&e.getBoundingClientRect().height>400).map(e=>({rect:rect(e),children:[...e.children].map(rect),html:e.outerHTML.slice(-3000)})),
    metrics:[...document.querySelectorAll('[data-framer-name]')].filter(e=>e.textContent==='5x').map(e=>({name:e.dataset.framerName,rect:rect(e),parents:[e.parentElement,e.parentElement.parentElement].map(rect)})),
    social:[...document.querySelectorAll('footer a')].filter(e=>/x.com|linkedin/.test(e.href)).map(a=>({href:a.href,mask:getComputedStyle(a.firstElementChild).maskImage})),
   };
  });
  result[width]=layout;
 }
 return result;
}
