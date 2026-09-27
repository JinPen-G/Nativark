async (page) => {
 return await page.evaluate(()=>{
  const text=[...document.querySelectorAll('h2')].find(e=>e.textContent.includes('next bestselling'));
  let card=text;while(card&&card.getBoundingClientRect().height!==650)card=card.parentElement;
  return [...card.querySelectorAll('div')].filter(e=>e.getBoundingClientRect().width>700&&e.getBoundingClientRect().height>600).map(e=>({name:e.dataset.framerName,cls:e.className,bg:getComputedStyle(e).backgroundColor,opacity:getComputedStyle(e).opacity,filter:getComputedStyle(e).filter}));
 });
}
