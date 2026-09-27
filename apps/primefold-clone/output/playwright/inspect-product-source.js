async(page)=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');await page.waitForTimeout(800);
 await page.mouse.move(5,5);
 await page.evaluate(()=>{window.lenis?.stop();scrollTo({top:2250,behavior:'instant'});});
 await page.waitForTimeout(600);
 const collect=()=>{
  const style=e=>{const s=getComputedStyle(e);return {tag:e.tagName,cls:e.className,name:e.dataset.framerName,text:e.textContent?.slice(0,130),rect:e.getBoundingClientRect().toJSON(),font:s.font,size:s.fontSize,line:s.lineHeight,space:s.letterSpacing,weight:s.fontWeight,wrap:s.whiteSpace,bg:s.backgroundColor,color:s.color,transform:s.transform,border:s.border,padding:s.padding,gap:s.gap};};
  const imgs=[...document.querySelectorAll('img')].filter(e=>e.src.includes('0nTcgou')).map(e=>[e,e.parentElement,e.parentElement.parentElement,e.parentElement.parentElement.parentElement].map(style));
  const metrics=[...document.querySelectorAll('div,span,p')].filter(e=>e.textContent.replace(/[\s\u200b]/g,'').startsWith('150customers')&&e.textContent.length<40).map(style);
  const lease=[...document.querySelectorAll('p')].filter(e=>e.textContent.includes('Villa Serena')).map(e=>[e.parentElement,e.parentElement.parentElement,e.parentElement.parentElement.parentElement].map(style));
  return {imgs,metrics,lease};
 };
 const desktop=await page.evaluate(collect);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(600);
 const mobile=await page.evaluate(collect);
 return {desktop,mobile};
}
