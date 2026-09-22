// 多租户识别纯逻辑专项：一套部署服务多个租户，靠 resolveSite 从参数/域名/环境变量解析当前租户。
// 用 node --test 直接跑（import.meta.env 在 node 下为 undefined，已用可选链兜底）。
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modUrl = pathToFileURL(path.join(__dirname, '..', 'apps/tenant-website/src/data/resolveTenant.ts')).href;

test('tenantCodeFromHost：子域名识别租户，保留字/IP/localhost/裸域返回 null', async () => {
  const { tenantCodeFromHost } = await import(modUrl);
  assert.equal(tenantCodeFromHost('guangying.rentalos.com', 'rentalos.com'), 'guangying');
  assert.equal(tenantCodeFromHost('shanye.rentalos.com:443', 'rentalos.com'), 'shanye');
  assert.equal(tenantCodeFromHost('www.rentalos.com', 'rentalos.com'), null, 'www 是保留子域');
  assert.equal(tenantCodeFromHost('api.rentalos.com', 'rentalos.com'), null, 'api 是保留子域');
  assert.equal(tenantCodeFromHost('rentalos.com', 'rentalos.com'), null, '裸域不是租户');
  assert.equal(tenantCodeFromHost('other.com', 'rentalos.com'), null, '非基础域名不认');
  assert.equal(tenantCodeFromHost('localhost', 'rentalos.com'), null);
  assert.equal(tenantCodeFromHost('127.0.0.1', 'rentalos.com'), null);
  // 未配基础域名时按「至少三段」取最左一段。
  assert.equal(tenantCodeFromHost('demo.example.com', undefined), 'demo');
  assert.equal(tenantCodeFromHost('example.com', undefined), null);
});

test('resolveSite：?tenant= 演示优先，其次 ?tenantCode=，再域名，同一部署服务多租户', async () => {
  const { resolveSite } = await import(modUrl);
  // 1. 演示形态（三种）显式优先，走本地静态数据。
  assert.deepEqual(resolveSite('?tenant=single', 'guangying.rentalos.com'), { kind: 'demo', demoKey: 'single' });
  assert.deepEqual(resolveSite('?tenant=double', 'x.rentalos.com'), { kind: 'demo', demoKey: 'double' });
  assert.deepEqual(resolveSite('?tenant=multiple', ''), { kind: 'demo', demoKey: 'multiple' });
  // 2. 显式 tenantCode 高于域名（联调/后台跳转）。
  assert.deepEqual(resolveSite('?tenantCode=demo', 'other.rentalos.com'), { kind: 'remote', tenantCode: 'demo' });
  // 3. 纯域名识别：同一份代码，不同子域 = 不同租户。
  assert.deepEqual(resolveSite('', 'guangying.rentalos.com'), { kind: 'remote', tenantCode: 'guangying' });
  assert.deepEqual(resolveSite('', 'shanye.rentalos.com'), { kind: 'remote', tenantCode: 'shanye' });
  // 4. 无参数、无可识别域名 → 回退演示 multiple，保证空环境可打开。
  assert.deepEqual(resolveSite('', 'localhost:4186'), { kind: 'demo', demoKey: 'multiple' });
});
