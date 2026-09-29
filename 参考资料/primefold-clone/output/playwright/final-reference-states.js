async (page) => {
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://localhost:8137/');await page.waitForTimeout(1000);
 await page.evaluate(()=>{window.lenis?.stop();scrollTo({top:0,behavior:'instant'});});
 await page.mouse.move(650,35);
 await page.waitForTimeout(300);
 await page.screenshot({path:'output/playwright/source-desktop-menu.png'});
 await page.mouse.move(1200,400);
 await page.evaluate(()=>scrollTo({top:5550,behavior:'instant'}));await page.waitForTimeout(2200);
 await page.screenshot({path:'output/playwright/source-desktop-5550.png'});
 return {captured:'matched menu and settled outcomes'};
}
