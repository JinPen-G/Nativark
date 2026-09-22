// 端到端校验 remoteSite 映射：对着真实 API 跑 bootstrap + public/catalog，
// 断言产出的 Tenant/Product/categoryMode 结构合法。这是官网真实接入的收口验证手段
// （替代浏览器人工点检）。用法：node scripts/verify-remote-mapping.mjs [tenantCode ...]
//
// 映射逻辑与 src/data/remoteSite.ts 保持一致；两边同源改动时一起更新。

const API = process.env.VERIFY_API_BASE ?? 'http://127.0.0.1:3000';
const codes = process.argv.slice(2).length ? process.argv.slice(2) : ['demo', 'demo2'];

const CATEGORY_ICON = { CAMERA: 'camera', CAMPING: 'camping', VEHICLE: 'car', DIGITAL: 'laptop', CONSTRUCTION: 'tool', HOME: 'home', BABY: 'baby', SPORTS: 'sports' };
const PRICE_UNIT = { day_24h: '天', day: '天', hour: '小时', week: '周', month: '月' };

let failures = 0;
const assert = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } };

async function getJson(path, params) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API}/api/client/v1${path}?${query}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  const body = await res.json();
  return body?.data ?? body;
}

function toProduct(item, categoryId, groupId) {
  return {
    id: item.id, name: item.name,
    cover: item.images?.[0]?.url || '/assets/product-camera.webp',
    categoryId, subCategoryId: groupId,
    price: item.startingPrice?.amount ?? 0,
    priceUnit: PRICE_UNIT[item.startingPrice?.unit ?? ''] ?? '天',
    deposit: 0, rating: 0, reviewCount: 0, stockStatus: 'available', availableQuantity: 1,
  };
}

async function verify(code) {
  console.log(`\n=== tenantCode=${code} ===`);
  const bootstrap = await getJson('/public/bootstrap', { tenantCode: code, client: 'web' });
  const open = bootstrap.services.filter((s) => s.status === 'open');
  const mode = open.length === 1 ? 'single' : open.length === 2 ? 'double' : 'multiple';
  console.log(`  services=${open.length} → categoryMode=${mode}`);

  assert(bootstrap.merchant?.name, 'merchant.name 非空');
  assert(open.length >= 1, '至少一个已发布服务');
  assert(bootstrap.client === 'web', 'client 回显为 web');

  const catalogs = await Promise.all(open.map((s) => getJson('/public/catalog', { tenantCode: code, service: s.code }).catch(() => null)));
  const categories = open.map((s, i) => {
    const cat = catalogs[i];
    assert(CATEGORY_ICON[s.categoryCode] !== undefined, `品类 ${s.categoryCode} 有对应图标键`);
    return { id: s.code, name: s.name, itemCount: cat?.items?.length ?? 0, groups: cat?.pricingGroups?.length ?? 0 };
  });

  const products = [];
  open.forEach((s, i) => {
    const cat = catalogs[i];
    cat?.items?.forEach((item) => {
      const g = cat.pricingGroups?.find((pg) => pg.memberItemGroupIds?.includes(item.id));
      products.push(toProduct(item, s.code, g?.id ?? item.id));
    });
  });

  const enabled = new Set(categories.map((c) => c.id));
  assert(products.every((p) => enabled.has(p.categoryId)), '每个商品的 categoryId 落在已发布品类内（getProducts 过滤可用）');
  assert(products.every((p) => typeof p.price === 'number' && p.price >= 0), '商品价格为非负数');
  assert(products.every((p) => p.cover && p.name && p.id), '商品有 id/名称/封面');

  const website = bootstrap.website;
  console.log(`  website: ${website ? 'present' : 'none'}${website ? ` (hero="${website.heroTitle ?? ''}", showPoweredBy=${website.showPoweredBy})` : ''}`);
  console.log(`  categories: ${categories.map((c) => `${c.name}[${c.itemCount}件/${c.groups}组]`).join(', ')}`);
  console.log(`  products mapped: ${products.length}`);
}

for (const code of codes) {
  try { await verify(code); } catch (e) { console.error(`  ✗ ${code}: ${e.message}`); failures++; }
}

console.log(failures === 0 ? '\n✅ 全部断言通过' : `\n❌ ${failures} 处断言失败`);
process.exit(failures === 0 ? 0 : 1);
