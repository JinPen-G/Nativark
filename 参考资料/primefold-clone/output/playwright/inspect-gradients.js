async (page) => {
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');await page.waitForTimeout(500);
 return await page.evaluate(()=>[...document.querySelectorAll('div')].filter(e=>/linear-gradient/.test(getComputedStyle(e).backgroundImage)&&e.getBoundingClientRect().width>450).map(e=>({name:e.dataset.framerName,cls:e.className,bg:getComputedStyle(e).backgroundImage,opacity:getComputedStyle(e).opacity,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).slice(-25));
}
