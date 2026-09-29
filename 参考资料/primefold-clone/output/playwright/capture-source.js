async (page) => {
  await page.setViewportSize({width:1440,height:1000});
  const consent=page.getByRole('button',{name:'Reject All',exact:true});
  if(await consent.isVisible()) await consent.click();
  const records=[];
  for(const y of [0,1250,2250,3150,3950,4750,5550,6250,7000]) {
    await page.evaluate(y=>{window.lenis?.stop();window.scrollTo({top:y,behavior:'instant'});},y);
    await page.waitForTimeout(800);
    await page.screenshot({path:`output/playwright/source-desktop-${y}.png`});
    records.push(await page.evaluate(()=>({y:scrollY,heads:[...document.querySelectorAll('h1,h2,h3')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.top>=0&&r.top<innerHeight;}).map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON(),style:{font:getComputedStyle(e).font,lineHeight:getComputedStyle(e).lineHeight,color:getComputedStyle(e).color,spacing:getComputedStyle(e).letterSpacing}}))})));
  }
  const data=await page.evaluate(records=>{
    const image=(e)=>({src:e.getAttribute('src'),srcset:e.getAttribute('srcset'),alt:e.alt,rect:e.getBoundingClientRect().toJSON()});
    const top=[...document.querySelectorAll('#main > .framer-jTcP9 > div')].map(e=>({class:e.className,name:e.getAttribute('data-framer-name'),rect:e.getBoundingClientRect().toJSON(),children:[...e.children].map(c=>({tag:c.tagName,class:c.className,name:c.getAttribute('data-framer-name'),id:c.id,rect:c.getBoundingClientRect().toJSON(),text:c.innerText?.slice(0,1000)}))}));
    const named=[...document.querySelectorAll('[data-framer-name]')].filter(e=>e.getBoundingClientRect().width&&e.querySelector('img')&&['Testimonial Card 1','Testimonial Card 2','Testimonial Card 3','Testimonial Card 5','Solutions Card 1','Solutions Card 2','Solutions Card 3','Solutions Card 4','Solutions Card 5','Footer','Nav','How It Works'].includes(e.dataset.framerName)).map(e=>({name:e.dataset.framerName,class:e.className,images:[...e.querySelectorAll('img')].map(image),text:e.innerText}));
    const backgrounds=[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).backgroundImage.includes('url(')).map(e=>({tag:e.tagName,class:e.className,name:e.getAttribute('data-framer-name'),bg:getComputedStyle(e).backgroundImage,rect:e.getBoundingClientRect().toJSON()}));
    const svg=[...document.querySelectorAll('div[id=svg-templates] svg,svg[id]')].map(e=>({id:e.id,svg:e.outerHTML}));
    const headings=[...document.querySelectorAll('h1,h2,h3')].filter(e=>e.getBoundingClientRect().width).map(e=>{let p=e;while(p.parentElement&&p.getBoundingClientRect().width<1000)p=p.parentElement;return {text:e.textContent,ancestors:[e.parentElement,e.parentElement.parentElement,e.parentElement.parentElement.parentElement].map(c=>({tag:c.tagName,class:c.className,name:c.getAttribute('data-framer-name'),rect:c.getBoundingClientRect().toJSON()})),images:[...p.querySelectorAll('img')].map(image)};});
    return {records,top,named,backgrounds,svg,headings,images:[...document.images].map(image),links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.textContent.trim(),href:e.getAttribute('href')})),text:document.body.innerText};
  },records);
  const downloadPromise=page.waitForEvent('download');
  await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='source-evidence.json';a.click();},data);
  await (await downloadPromise).saveAs('output/playwright/source-evidence.json');
  await page.setViewportSize({width:390,height:844});
  for(const y of [0,850,2200,3550,4600,5800,7100,8400]) {
    await page.evaluate(y=>window.scrollTo({top:y,behavior:'instant'}),y);
    await page.waitForTimeout(700);
    await page.screenshot({path:`output/playwright/source-mobile-${y}.png`});
  }
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  return {captured:true,desktop:records.length,mobile:8};
}
