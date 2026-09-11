async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const writes = [];
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const states = ['待确认', '已锁分配', '租用中', '检查完成', '已完成'];
  const names = ['预约报价', '商品分配', '领取使用', '归还检查', '费用结算'];
  for (let i = 0; i < 5; i++) {
    await page.getByRole('tab', { name: new RegExp(names[i]) }).click();
    assert(await page.locator('.order-status').innerText() === states[i], 'workflow state ' + i);
  }
  await page.getByRole('tab', { name: /费用结算/ }).focus();
  await page.keyboard.press('Home');
  assert(await page.locator('.order-status').innerText() === '待确认', 'keyboard tabs');
  for (const name of ['摄影器材', '车辆载具', '露营装备', '工程设备']) {
    await page.getByRole('button', { name, exact: true }).click();
    const photo = page.locator('.industry-photo img');
    await photo.evaluate(img => img.decode());
    assert((await photo.getAttribute('alt')).includes(name), 'industry image ' + name);
  }
  await page.getByRole('button', { name: '咨询系统订阅方案', exact: true }).click();
  await page.getByRole('button', { name: '预览预约结果', exact: true }).click();
  assert(await page.locator('form input:invalid').count() > 0, 'required validation');
  await page.getByRole('textbox', { name: '商户名称', exact: true }).fill('官网验收示例');
  await page.getByRole('textbox', { name: '你的称呼', exact: true }).fill('测试');
  await page.getByRole('textbox', { name: '手机号或 Email', exact: true }).fill('website@example.test');
  await page.getByRole('button', { name: '预览预约结果', exact: true }).click();
  assert((await page.getByRole('status').innerText()).includes('信息没有发送或保存'), 'preview honesty');
  await page.keyboard.press('Escape');
  assert(await page.locator('dialog[open]').count() === 0, 'escape closes modal');
  await page.getByRole('button', { name: '隐私说明', exact: true }).click();
  assert(await page.getByRole('heading', { name: '预览版隐私说明' }).isVisible(), 'privacy modal');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow ' + width);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(await page.locator('.hero h1').evaluate(el => getComputedStyle(el).animationName) === 'none', 'reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  assert(await page.getByRole('navigation', { name: '主导航' }).isVisible(), 'mobile menu opens');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '产品功能', exact: true }).click();
  assert(!await page.getByRole('navigation', { name: '主导航' }).isVisible(), 'mobile navigation closes');
  await page.screenshot({ path: 'output/playwright/rental-website-mobile-product.png' });
  assert(writes.length === 0, 'no external submission');
  return { passed: ['five workflow states', 'keyboard tabs', 'four industry images', 'required validation', 'preview-only submission', 'escape close', 'privacy', 'four widths', 'reduced motion', 'mobile navigation'], networkWrites: writes };
}
