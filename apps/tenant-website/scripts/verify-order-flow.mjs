// 端到端校验官网「登录 → 报价 → 下单 → 订单」真实链路（对着本地 dev API）。
// 自带账号自助注册（dev 环境返回一次性验证码），因此对任意 dev 库可重复运行。
// 用法：node apps/tenant-website/scripts/verify-order-flow.mjs [tenantCode]
//
// 这是官网登录态接入的收口验证手段，替代浏览器人工点检。映射逻辑与 authClient/RemoteBooking 对齐。

const API = process.env.VERIFY_API_BASE ?? 'http://127.0.0.1:3000';
const tenantCode = process.argv[2] || 'demo';
const B = `${API}/api/client/v1`;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures++; };
const jf = async (r) => { const j = await r.json().catch(() => ({})); return { status: r.status, data: j.data ?? j }; };
const pub = (path, body) => fetch(`${B}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(jf);

async function main() {
  const phone = `139${String(Date.now()).slice(-8)}`;
  const password = 'Verify@12345';

  // 注册（dev 一次性验证码）
  const ch = await pub('/auth/registration/challenges', { tenantCode, method: 'sms', identifier: phone, idempotencyKey: `v-${phone}` });
  ok(ch.status === 201 && ch.data.developmentCode, 'registration challenge issues a dev code');
  const vt = (await pub(`/auth/registration/challenges/${ch.data.challengeId}/verify`, { code: ch.data.developmentCode })).data.verificationToken;
  const reg = await pub('/auth/register', { tenantCode, name: '验收用户', phone, password, verificationToken: vt, idempotencyKey: `v-${phone}`, consent: { userAgreementVersion: '1', privacyPolicyVersion: '1', agreedAt: new Date().toISOString() } });
  ok(reg.status === 201 || reg.data.customerId, 'register creates a customer');

  // 登录
  const login = await pub('/auth/login', { tenantCode, loginIdentifier: phone, password });
  const token = login.data.accessToken;
  ok(!!token && !!login.data.refreshToken, 'password login returns access + refresh tokens');
  const authed = (path, init = {}) => fetch(`${B}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } }).then(jf);

  // 目录 → 取地点/型号
  const cat = (await authed('/catalog')).data;
  const loc = cat.locations?.[0]?.id, item = cat.items?.[0]?.id;
  ok(!!loc && !!item, 'authed catalog exposes a location and an item group');
  const mode = (cat.fulfillment?.enabledModes || []).find(m => m.endsWith('pickup_return')) || 'store_pickup_return';
  const start = '2026-11-03T09:00:00.000Z', end = '2026-11-05T09:00:00.000Z';

  // 可用性
  const avail = await authed('/availability', { method: 'POST', body: JSON.stringify({ locationId: loc, startAt: start, endAt: end, lines: [{ itemGroupId: item, quantity: 1 }] }) });
  ok(avail.status === 201 && typeof avail.data.available === 'boolean', 'availability returns a boolean');

  // 报价（服务端计价）
  const quote = await authed('/quotes', { method: 'POST', body: JSON.stringify({ fulfillmentMode: mode, fulfillmentLocationId: loc, startAt: start, endAt: end, lines: [{ itemGroupId: item, quantity: 1 }] }) });
  ok(quote.status === 201 && quote.data.id && typeof quote.data.payableAmount === 'number', 'quote returns id + server-computed payableAmount');

  // 下单
  const order = await authed('/orders', { method: 'POST', headers: { 'Idempotency-Key': `v-order-${phone}` }, body: JSON.stringify({ quoteId: quote.data.id }) });
  const orderId = order.data.order?.id;
  ok(order.status === 201 && !!orderId, 'order is created from the quote');

  // 我的订单 + 详情
  const mine = await authed('/my/orders?page=1&pageSize=20');
  ok((mine.data.items || []).some(o => o.orderId === orderId), 'new order appears in /my/orders');
  const detail = await authed(`/orders/${orderId}`);
  ok(detail.status === 200 && detail.data.orderNo, 'order detail loads');

  // 支付能力（可能为空，仅确认接口可达）
  const caps = await authed('/payment/capabilities');
  ok(caps.status === 200, 'payment capabilities endpoint reachable');
  console.log(`  · payment methods: ${JSON.stringify(caps.data)}`);
}

main().then(() => {
  console.log(failures === 0 ? '\n✅ 登录→报价→下单→订单 全链路通过' : `\n❌ ${failures} 处断言失败`);
  process.exit(failures === 0 ? 0 : 1);
}).catch(e => { console.error('ERR', e.message); process.exit(1); });
