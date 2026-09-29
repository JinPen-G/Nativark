// Read-only runtime audit: original vs editable source. No app files changed.
async (page) => {
await page.setViewportSize({ width: 1920, height: 1080 });
const original = !page.url().includes('/source/');
const name = original ? 'ref' : 'built';
await page.goto(original ? 'http://localhost:8137/' : 'http://localhost:8137/source/');
await page.waitForTimeout(1600);
await page.mouse.move(1880, 100);
const targets = await page.evaluate((original) => {
  const quote = document.querySelector(original ? '[data-framer-name="Quote Carousel Desktop"]' : '.quote-viewport');
  const teams = document.querySelector(original ? '.framer-1n6mbe9' : '.teams-track');
  return { quote: quote.getBoundingClientRect().top + scrollY, teams: teams.getBoundingClientRect().top + scrollY };
}, original);
const samples = [];
async function sample(type, top, screenshot = false, hold = 0) {
  await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), Math.round(targets[type] - top));
  await page.waitForTimeout(hold || 700);
  const result = await page.evaluate(({ original, type }) => {
    const quoteRoot = document.querySelector(original ? '[data-framer-name="Quote Carousel Desktop"]' : '.quote-section');
    const quote = original ? quoteRoot.querySelector('[data-rel="0"]') : quoteRoot.querySelector('.quote-slot[data-quote-relative="0"] .quote-card');
    const teams = document.querySelector(original ? '.framer-8n39hk-container' : '.teams-track');
    const card = original ? teams.querySelector('h3').closest('.framer-gkwvoi-container') : teams.querySelector('.team-card');
    const rect = (e) => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return { x: r.x, y: r.y, width: r.width, height: r.height, transform: s.transform, inline: e.getAttribute('style'), scrollLeft: e.scrollLeft };
    };
    const ancestors = [];
    for(let e=card, i=0; e && e!==teams.parentElement && i<8; e=e.parentElement,i++) ancestors.push({class:e.className,...rect(e)});
    return { type, scrollY, quote:quote ? rect(quote) : null, quoteRoot:rect(quoteRoot), teams:rect(teams), card:card ? rect(card) : null, ancestors };
  }, { original, type });
  samples.push({ requestedTop:top,hold,...result });
  if(screenshot) await page.screenshot({path:`output/playwright/team-scroll-${name}-${type}-${top}.png`});
}
for (const top of [1080,900,720,540,360,302,180]) await sample('quote',top,[720,302].includes(top));
for (const top of [900,700,500,300,100,-100]) await sample('teams',top,[700,100].includes(top));
await sample('teams',100,false,2200);
await sample('teams',500,false);
return { original, targets, samples: samples.map(s => ({
  type:s.type,requestedTop:s.requestedTop,hold:s.hold,scrollY:s.scrollY,
  quote:s.quote && {x:s.quote.x,y:s.quote.y,width:s.quote.width,height:s.quote.height},
  teams:{x:s.teams.x,y:s.teams.y,transform:s.teams.transform,scrollLeft:s.teams.scrollLeft},
  card:{x:s.card.x,y:s.card.y,width:s.card.width},
  transforms:s.ancestors.filter(a=>a.transform!=='none').map(a=>({class:a.class,transform:a.transform}))
})) };
}
