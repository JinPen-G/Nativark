const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

/**
 * UI-NAV-01 专项：导航、面包屑与页面标题按当前经营空间的品类术语解析。
 *
 * 断言分两层：
 *   1. **行为层**：`resolveTenantNavigationLabels` 是纯函数，四个品类的术语各跑一遍，
 *      直接比对文案。这层证明"术语换了文案就换"，且四个品类走的是同一个函数。
 *   2. **接线层**：源码契约断言。纯函数正确但没人调用、或调用了却仍按品类编码分支，
 *      界面照样是错的——这层防的是"函数写对了、接线接歪了"。
 *
 * 路由 path、权限码与 SaaS 文案一并断言不变：换个说法不该换掉入口或门禁。
 */

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

/**
 * 管理端是 ESM 包，`.ts` 不能直接 require；而这里要断言的是**运行时行为**，
 * 不是源码文本。因此把纯模块转译成 CJS 后求值。
 * 该模块只有一个 `import type`（编译期擦除），求值时不触发任何依赖加载——
 * 这也正是把术语解析拆成无 JSX 纯模块的原因之一。
 *
 * 刻意用 `new Function` 在**当前 realm** 内求值，而不是 `vm.runInNewContext`：
 * 新 realm 里的对象带着另一份 Object 原型，`deepStrictEqual` 会必然失败，
 * 而 `notDeepEqual` 会必然通过——后者是静默失效的断言，比报错更危险。
 */
function loadPureTsModule(relative) {
  const { outputText } = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const shim = { exports: {} };
  new Function("module", "exports", "require", outputText)(shim, shim.exports, require);
  return shim.exports;
}

const { RENTAL_CATEGORY_DEFINITIONS } = require("@store-rental/shared");
const { resolveTenantNavigationLabels, applyTenantNavigationLabels } = loadPureTsModule("apps/admin/src/app/navigation-terminology.ts");

const ok = (m) => console.log(`  ✓ ${m}`);
const byCode = (code) => {
  const definition = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === code);
  assert.ok(definition, `品类事实源缺少 ${code}`);
  return definition;
};

void (() => {
  // ============ 1. 四个品类都由同一个纯函数解析出各自术语 ============
  const expectedByCode = {
    camera: { groups: { inventory: "摄影器材" }, routes: { itemGroups: "器材型号", pricingGroups: "器材定价分组", assets: "器材资产与库存", locations: "器材门店" } },
    camping: { groups: { inventory: "户外装备" }, routes: { itemGroups: "装备型号", pricingGroups: "装备定价分组", assets: "装备资产与库存", locations: "装备仓库" } },
    vehicle: { groups: { inventory: "车辆型号与车队" }, routes: { itemGroups: "厂牌车型管理", pricingGroups: "车组管理", assets: "车辆管理", locations: "门店管理" } },
    construction: { groups: { inventory: "工程设备" }, routes: { itemGroups: "设备型号", pricingGroups: "设备定价分组", assets: "设备台账与库存", locations: "设备仓库" } }
  };
  for (const [code, expected] of Object.entries(expectedByCode)) {
    const { terminology } = byCode(code);
    const labels = resolveTenantNavigationLabels(terminology);
    assert.deepEqual(labels, expected, `${code} 必须严格符合需求文档的五项导航文案`);
    // 固定的"商品""资产"字样必须消失——这正是 UI-NAV-01 要解决的问题。
    assert.equal(
      labels.routes.itemGroups.startsWith("商品"),
      false,
      `${code} 菜单仍以固定"商品"开头：${labels.routes.itemGroups}`
    );
  }
  ok("四个品类：菜单、分组与履约地点文案均由各自术语解析，不再是固定「商品/资产」");

  // ============ 2. 车辆空间必须区分 车辆型号 / 车组 / 车辆 / 车队 / 门店 ============
  const vehicle = resolveTenantNavigationLabels(byCode("vehicle").terminology);
  assert.equal(vehicle.routes.itemGroups, "厂牌车型管理", "车辆空间的目录菜单应明确这是厂商车型主档");
  assert.equal(vehicle.routes.pricingGroups, "车组管理", "车辆空间的定价分组菜单应为车组管理");
  assert.equal(vehicle.routes.assets, "车辆管理", "车辆空间的资产菜单应为车辆管理");
  assert.equal(vehicle.routes.locations, "门店管理", "车辆空间的履约地点应为门店管理");
  assert.equal(vehicle.groups.inventory, "车辆型号与车队", "车辆空间的导航分组应为车辆型号与车队");
  const vehicleText = JSON.stringify(vehicle);
  for (const word of ["车辆型号", "车组", "车辆", "车队", "门店"]) {
    assert.ok(vehicleText.includes(word), `车辆空间导航缺少「${word}」语义`);
  }
  ok("车辆空间：车辆型号 / 车组 / 车辆 / 车队 / 门店 五种语义齐备");

  // ============ 3. 换术语立刻换文案，且不依赖品类编码 ============
  const camera = resolveTenantNavigationLabels(byCode("camera").terminology);
  const camping = resolveTenantNavigationLabels(byCode("camping").terminology);
  assert.notDeepEqual(camera, vehicle, "换品类术语必须得到不同的导航文案");
  assert.notDeepEqual(camera, camping, "摄影与露营的导航文案不得相同");
  // 只喂术语、不喂品类编码也能解析：证明解析确实只依赖术语这一份事实源。
  const madeUp = resolveTenantNavigationLabels({
    itemLabel: "乐器", itemGroupLabel: "乐器型号", assetLabel: "乐器资产",
    fulfillmentLabel: "琴房", pickupLabel: "取琴", returnLabel: "还琴", identifierLabel: "乐器编号"
  });
  assert.equal(madeUp.routes.itemGroups, "乐器型号目录", "未登记的品类只要术语齐全就应正确解析");
  assert.equal(madeUp.routes.locations, "琴房");
  ok("术语驱动：换术语即换文案，未登记品类无需改代码即可正确解析");

  // ============ 4. 无品类档案时回落固定文案，绝不猜一个品类 ============
  // SaaS 平台账号与档案未就绪都走这条路径：猜一个品类会让平台导航染上某个租户的术语。
  assert.deepEqual(
    resolveTenantNavigationLabels(undefined),
    { routes: {}, groups: {} },
    "没有品类档案时必须返回空覆盖，由调用方回落固定文案"
  );
  ok("无档案：返回空覆盖，回落固定文案而不是猜测品类");

  // ============ 4-B. 套用：文案必须真的落到分组与菜单项上 ============
  // 只测解析函数是不够的——算对了却漏了套用那一行，界面照样是固定文案。
  const PATHS = { itemGroups: "/rental/item-groups", pricingGroups: "/rental/pricing-groups", assets: "/rental/assets", locations: "/rental/locations" };
  const registry = [
    { key: "inventory", label: "商品与资产", routes: [
      { path: PATHS.itemGroups, label: "商品目录", permission: "rental-core:catalog:view" },
      { path: PATHS.pricingGroups, label: "定价分组", permission: "store-rental:price:manage" },
      { path: PATHS.assets, label: "资产与库存", permission: "rental-core:asset:view" },
      { path: PATHS.locations, label: "履约地点", permission: "store-rental:station:view" }
    ] },
    { key: "transactions", label: "租赁交易", routes: [{ path: "/rental/orders", label: "订单管理", permission: "store-rental:order:view" }] },
    { key: "platform-management", label: "平台管理", routes: [{ path: "/platform/tenants", label: "SaaS 租户", permission: "system:tenant:manage" }] }
  ];
  const applied = applyTenantNavigationLabels(registry, byCode("vehicle").terminology, PATHS);
  const inventory = applied.find((section) => section.key === "inventory");
  assert.equal(inventory.label, "车辆型号与车队", "分组文案必须被套用");
  assert.equal(inventory.routes.find((r) => r.path === PATHS.itemGroups).label, "厂牌车型管理", "目录菜单文案必须被套用");
  assert.equal(inventory.routes.find((r) => r.path === PATHS.pricingGroups).label, "车组管理", "定价分组菜单文案必须被套用");
  assert.equal(inventory.routes.find((r) => r.path === PATHS.assets).label, "车辆管理", "资产菜单文案必须被套用");
  assert.equal(inventory.routes.find((r) => r.path === PATHS.locations).label, "门店管理", "履约地点文案必须被套用");
  // 只覆盖 label：其余路由元数据必须原样透传，否则「换说法」会顺手改掉门禁。
  assert.equal(
    inventory.routes.find((r) => r.path === PATHS.assets).permission,
    "rental-core:asset:view",
    "套用文案不得改动权限码"
  );
  // 未登记的分组与 SaaS 平台面保持固定文案。
  assert.equal(applied.find((s) => s.key === "transactions").label, "租赁交易", "跨品类分组文案不应被术语覆盖");
  assert.equal(applied.find((s) => s.key === "transactions").routes[0].label, "订单管理", "未纳入术语的菜单项不应被改写");
  const platform = applied.find((s) => s.key === "platform-management");
  assert.equal(platform.label, "平台管理", "SaaS 分组文案必须固定");
  assert.equal(platform.routes[0].label, "SaaS 租户", "SaaS 菜单文案必须固定");
  // 无档案时应与原注册表逐字段一致。
  assert.deepEqual(
    applyTenantNavigationLabels(registry, undefined, PATHS),
    registry,
    "没有品类档案时套用结果必须与固定注册表完全一致"
  );
  ok("套用：分组与菜单文案真的被替换，权限与 SaaS 文案原样保留，无档案时逐字段回落");

  // ============ 5. 解析层不得出现品类编码分支 ============
  const terminologySource = read("apps/admin/src/app/navigation-terminology.ts");
  const shell = read("apps/admin/src/components/AppShell.tsx");
  const nav = read("apps/admin/src/app/navigation.tsx");
  for (const [relative, source] of [
    ["navigation-terminology.ts", terminologySource],
    ["AppShell.tsx", shell]
  ]) {
    assert.equal(
      /["'](camera|camping|vehicle|construction)["']/iu.test(source),
      false,
      `${relative} 不得按品类编码分支——品类知识只应存在于品类事实源`
    );
  }
  ok("解析与外壳层：没有散落的品类编码判断");

  // ============ 6. 接线：外壳按当前空间取品类档案并驱动导航 ============
  assert.match(shell, /buildNavigationSections\(terminology\)/u, "左侧导航与面包屑必须由术语构建");
  assert.match(
    shell,
    /queryKey: \["rental-core", "profile"\]/u,
    "必须复用业务页面同一查询键，命中同一份缓存而不是多发一次请求"
  );
  assert.match(
    shell,
    /enabled: Boolean\(user && !user\.isSaasAdmin\)/u,
    "SaaS 平台账号不属于任何经营空间，不得发起租户品类档案请求"
  );
  // 面包屑与菜单共用 sections，故只需断言 sections 由术语派生。
  assert.match(shell, /const sections = useMemo\(\(\) => buildNavigationSections/u, "菜单与面包屑必须同源");
  assert.match(shell, /\[hasCapability, hasPermission, tenant\?\.categoryCode, terminology, user\?\.isSaasAdmin\]/u,
    "术语必须进入 useMemo 依赖，否则切换空间后导航不会重算");
  ok("接线：外壳按当前空间取档案，菜单与面包屑同源且随空间切换重算");

  // ============ 7. 只改文案，不改路由与鉴权契约 ============
  for (const [routePath, permission] of [
    ["/rental/item-groups", "rental-core:catalog:view"],
    ["/rental/pricing-groups", "store-rental:price:manage"],
    ["/rental/assets", "rental-core:asset:view"],
    ["/rental/locations", "store-rental:station:view"]
  ]) {
    assert.ok(nav.includes(`path: "${routePath}"`), `路由路径 ${routePath} 不得变更`);
    assert.ok(nav.includes(`permission: "${permission}"`), `权限码 ${permission} 不得变更`);
  }
  assert.match(
    nav,
    /只覆盖 `label`[\s\S]{0,600}export function buildNavigationSections/u,
    "构建函数必须显式声明只覆盖 label"
  );
  // SaaS 平台路由文案固定：平台面不随任何租户品类变化。
  for (const label of ["SaaS 租户", "组织与权限", "平台参数", "平台运维", "平台工具与治理", "公共官方日历"]) {
    assert.ok(nav.includes(`label: "${label}"`), `SaaS 平台路由文案必须保持固定：${label}`);
  }
  const saasLabels = ["SaaS 租户", "组织与权限", "平台参数"];
  const vehicleLabels = Object.values(vehicle.routes).concat(Object.values(vehicle.groups));
  for (const label of saasLabels) {
    assert.equal(vehicleLabels.includes(label), false, "品类术语不得覆盖 SaaS 平台文案");
  }
  ok("契约：路由路径、权限码与 SaaS 平台文案均未变更");

  // ============ 8. 页面标题与菜单同源 ============
  // 菜单叫「车辆与车队」而页面标题仍写死「资产与库存」，等于只改了一半。
  const assetPage = read("apps/admin/src/features/catalog/AssetWorkspacePage.tsx");
  assert.match(
    assetPage,
    /title=\{resolveTenantNavigationLabels\(profile\.data\?\.terminology\)\.routes\.assets \?\? "资产与库存"\}/u,
    "资产页标题必须与菜单同源解析，并保留固定回落"
  );
  const catalogPage = read("apps/admin/src/features/catalog/CatalogPage.tsx");
  const pricingGroupPage = read("apps/admin/src/features/commercial/PricingGroupPage.tsx");
  const locationPage = read("apps/admin/src/features/fulfillment/LocationPage.tsx");
  assert.match(catalogPage, /resolveTenantNavigationLabels\(profile\.data\?\.terminology\)\.routes\.itemGroups/u, "商品目录页标题必须与菜单使用同一解析结果");
  assert.match(catalogPage, /pricingGroup\.memberItemGroupIds\.includes\(row\.id\)/u, "产品型号页必须反向显示所属的全部定价分组");
  assert.match(pricingGroupPage, /row\.members\.length[\s\S]{0,180}member\.name[\s\S]{0,80}member\.code/u, "定价分组页必须显示包含的型号名称和编码");
  assert.doesNotMatch(catalogPage, /category(Code)?\s*===?\s*["']vehicle["']/u, "品类主档页面不得通过 vehicle 硬编码分支实现展示差异");
  assert.match(locationPage, /resolveTenantNavigationLabels\(profile\.data\?\.terminology\)\.routes\.locations/u, "履约地点页标题必须与菜单使用同一解析结果");
  const coreService = read("apps/api/src/modules/rental-core/rental-core.service.ts");
  assert.match(coreService, /navigationLabels:[\s\S]{0,180}defaults\.navigationLabels[\s\S]{0,180}profile\.terminology\.navigationLabels/u,
    "旧空间读取档案时必须补入品类定义的导航配置，不能只让新空间生效");
  ok("页面标题：资产、目录与地点页标题均由当前品类术语驱动");

  console.log("\nUI-NAV-01 导航术语专项：全部通过");
})();
