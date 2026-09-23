// 多租户识别纯逻辑专项：一套部署服务多个租户，靠 resolveSite 从参数/域名/环境变量解析当前租户。
// 用 node --test 直接跑（import.meta.env 在 node 下为 undefined，已用可选链兜底）。
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modUrl = pathToFileURL(path.join(__dirname, '..', 'apps/tenant-website/src/data/resolveTenant.ts')).href;

test('tenantCodeFromHost：只认配置的基础域名的直接子域，保留字/裸域/客户域名返回 null', async () => {
  const { tenantCodeFromHost } = await import(modUrl);
  assert.equal(tenantCodeFromHost('guangying.rentalos.com', 'rentalos.com'), 'guangying');
  assert.equal(tenantCodeFromHost('shanye.rentalos.com:443', 'rentalos.com'), 'shanye');
  assert.equal(tenantCodeFromHost('www.rentalos.com', 'rentalos.com'), null, 'www 是保留子域');
  assert.equal(tenantCodeFromHost('api.rentalos.com', 'rentalos.com'), null, 'api 是保留子域');
  assert.equal(tenantCodeFromHost('rentalos.com', 'rentalos.com'), null, '裸域不是租户');
  assert.equal(tenantCodeFromHost('other.com', 'rentalos.com'), null, '非基础域名不认');
  assert.equal(tenantCodeFromHost('localhost', 'rentalos.com'), null);
  assert.equal(tenantCodeFromHost('127.0.0.1', 'rentalos.com'), null);
  // 未配基础域名时一律 null，把客户自定义域名交给后端反查，不再猜最左一段。
  assert.equal(tenantCodeFromHost('demo.example.com', undefined), null);
  assert.equal(tenantCodeFromHost('shop.brand.com', undefined), null);
});

test('resolveSite：演示 > tenantCode > 子域名 > 自定义域名(交后端反查) > 兜底', async () => {
  const { resolveSite } = await import(modUrl);
  const base = { baseDomain: 'rentalos.com', defaultTenant: undefined };
  // 1. 演示形态（三种）显式优先，走本地静态数据。
  assert.deepEqual(resolveSite('?tenant=single', 'guangying.rentalos.com', base), { kind: 'demo', demoKey: 'single' });
  assert.deepEqual(resolveSite('?tenant=double', 'x.rentalos.com', base), { kind: 'demo', demoKey: 'double' });
  // 2. 显式 tenantCode 高于域名（联调/后台跳转）。
  assert.deepEqual(resolveSite('?tenantCode=demo', 'other.rentalos.com', base), { kind: 'remote', tenantCode: 'demo' });
  // 3. 平台子域名：同一份代码，不同子域 = 不同租户。
  assert.deepEqual(resolveSite('', 'guangying.rentalos.com', base), { kind: 'remote', tenantCode: 'guangying' });
  // 4. 客户自定义域名：需后端按 Host 反查，fallback 为演示 multiple。
  assert.deepEqual(resolveSite('', 'www.brand.com', base), { kind: 'host', host: 'www.brand.com', fallback: { kind: 'demo', demoKey: 'multiple' } });
  // 5. 单租户部署：VITE_DEFAULT_TENANT 兜底（本地地址不反查，直接兜底到该租户）。
  assert.deepEqual(resolveSite('', 'localhost:4186', { baseDomain: 'rentalos.com', defaultTenant: 'demo' }), { kind: 'remote', tenantCode: 'demo' });
  // 6. 平台裸域名（无参数）→ 兜底演示 multiple，不当作自定义域名反查。
  assert.deepEqual(resolveSite('', 'rentalos.com', base), { kind: 'demo', demoKey: 'multiple' });
  // 7. 自定义域名但配了默认租户 → host 反查，fallback 为该默认租户。
  assert.deepEqual(resolveSite('', 'shop.brand.com', { baseDomain: 'rentalos.com', defaultTenant: 'demo' }), { kind: 'host', host: 'shop.brand.com', fallback: { kind: 'remote', tenantCode: 'demo' } });
});
