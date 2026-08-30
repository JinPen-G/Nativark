const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  resolveQuoteServices,
  serviceBillingUnits,
  mandatoryRuleHit
} = require("../apps/api/src/modules/rental-core/rental-service-catalog");

/**
 * MKT-02A 专项：增值服务目录的适用性、计费单位、条件强制与条款快照（需求 4.4.11）。
 *
 * 纯函数用例：四个品类共用同一套判定，因此这里不出现任何品类编码；
 * 端到端报价只能证明总额对得上，无法定位是哪条适用性判据算错了。
 */

const ok = (message) => console.log(`  PASS  ${message}`);
const TZ = "Asia/Shanghai";

const service = (over = {}) => ({
  id: over.id ?? `svc_${over.code ?? "X"}`,
  tenantId: "t1",
  categoryCode: "camping",
  code: over.code ?? "X",
  name: over.name ?? `服务 ${over.code ?? "X"}`,
  serviceType: "other",
  billingUnit: "per_order",
  price: 100,
  minimumQuantity: 1,
  maximumQuantity: 5,
  termsVersion: "1.0",
  terms: "默认条款",
  applicableItemGroupIds: [],
  applicableFulfillmentModes: [],
  applicableLocationIds: [],
  customerScope: "all",
  selectionMode: "optional",
  status: "enabled",
  version: "1.0",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over
});

const ctx = (over = {}) => ({
  selections: over.selections ?? [],
  itemGroupIds: over.itemGroupIds ?? ["g1"],
  fulfillmentMode: over.fulfillmentMode ?? "store_pickup_return",
  locationIds: over.locationIds ?? ["loc1"],
  customerType: over.customerType ?? "personal",
  startAt: over.startAt ?? "2026-06-01T02:00:00.000Z",
  endAt: over.endAt ?? "2026-06-03T02:00:00.000Z",
  timeZone: TZ,
  rentalAmount: over.rentalAmount ?? 1000,
  workspaceId: over.workspaceId ?? "ws1"
});

const rejects = (fn, pattern, label) => {
  assert.throws(fn, (error) => {
    assert.match(error.message, pattern, `${label}：实际 ${error.message}`);
    return true;
  }, label);
};

// ============ 1. 计费单位：自然日不是 24 小时块 ============
{
  // 周一 22:00 到周二 08:00（+08:00）只有 10 小时，但占用两个自然日：
  // 门店那两天都得排清洁工位。按 24 小时折算只会算成 1 天，少收一天。
  const shortOvernightStart = "2026-06-01T14:00:00.000Z"; // 22:00 +08:00
  const shortOvernightEnd = "2026-06-02T00:00:00.000Z"; // 次日 08:00 +08:00
  assert.equal(serviceBillingUnits("per_day", shortOvernightStart, shortOvernightEnd, TZ), 2, "每自然日必须按占用日期数计");
  assert.equal(serviceBillingUnits("per_night", shortOvernightStart, shortOvernightEnd, TZ), 1, "过夜数按跨过的日界计");
  assert.equal(serviceBillingUnits("per_hour", shortOvernightStart, shortOvernightEnd, TZ), 10);
  assert.equal(serviceBillingUnits("per_rental_period", shortOvernightStart, shortOvernightEnd, TZ), 1, "整段租期恒为 1");
  assert.equal(serviceBillingUnits("per_order", shortOvernightStart, shortOvernightEnd, TZ), 1);
  assert.equal(serviceBillingUnits("per_unit", shortOvernightStart, shortOvernightEnd, TZ), 1);
  // 同日租还：自然日 1、过夜 0。
  assert.equal(serviceBillingUnits("per_day", "2026-06-01T02:00:00.000Z", "2026-06-01T08:00:00.000Z", TZ), 1);
  assert.equal(serviceBillingUnits("per_night", "2026-06-01T02:00:00.000Z", "2026-06-01T08:00:00.000Z", TZ), 0);
  ok("计费单位：每自然日按占用日期数、每晚按过夜数、整段租期恒为 1");
}

// ============ 2. 金额 = 单价 × 份数 × 单位数，并固化公式 ============
{
  const svc = service({ code: "CLEAN", price: 50, billingUnit: "per_day", maximumQuantity: 3 });
  const { snapshots, totalAmount } = resolveQuoteServices([svc], ctx({ selections: [{ serviceId: svc.id, quantity: 2 }] }));
  // 2026-06-01T02:00Z(10:00) → 2026-06-03T02:00Z(10:00)：占用 1、2、3 三个自然日。
  assert.equal(snapshots[0].billingUnits, 3);
  assert.equal(snapshots[0].amount, 300);
  assert.equal(totalAmount, 300);
  assert.match(snapshots[0].formula, /50 × 2 份 × 3 per_day = 300/, "公式必须能直接展示给客户核对");
  assert.equal(snapshots[0].serviceVersion, "1.0", "快照必须带服务版本");
  assert.equal(snapshots[0].termsVersion, "1.0");
  assert.equal(snapshots[0].terms, "默认条款", "条款正文必须整段固化，只存版本号取不回历史正文");
  assert.equal(snapshots[0].workspaceId, "ws1", "快照必须带经营空间");
  ok("金额与快照：单价 × 份数 × 单位数，公式、版本、条款正文与空间齐备");
}

// ============ 3. 适用范围不匹配必须明确拒绝，不静默丢弃 ============
{
  const cases = [
    [service({ code: "G", applicableItemGroupIds: ["other"] }), /不适用于本次报价.*item_group/u, "商品组"],
    [service({ code: "M", applicableFulfillmentModes: ["delivery"] }), /不适用于本次报价.*fulfillment_mode/u, "履约方式"],
    [service({ code: "L", applicableLocationIds: ["locX"] }), /不适用于本次报价.*location/u, "地点"],
    [service({ code: "C", customerScope: "corporate" }), /不适用于本次报价.*customer_scope/u, "客户类型"],
    [service({ code: "S", status: "disabled" }), /不适用于本次报价.*status/u, "停用服务"]
  ];
  for (const [svc, pattern, label] of cases) {
    rejects(() => resolveQuoteServices([svc], ctx({ selections: [{ serviceId: svc.id, quantity: 1 }] })), pattern, label);
  }
  // 空数组表示不限制，不是「都不适用」。
  const open = service({ code: "OPEN" });
  assert.equal(resolveQuoteServices([open], ctx({ selections: [{ serviceId: open.id, quantity: 1 }] })).snapshots.length, 1);
  ok("适用范围：商品、履约方式、地点、客户类型、状态五类不匹配都明确拒绝；空数组＝不限制");
}

// ============ 4. 数量范围按服务自己的上下限判定 ============
{
  const svc = service({ code: "PAIR", minimumQuantity: 2, maximumQuantity: 4 });
  rejects(() => resolveQuoteServices([svc], ctx({ selections: [{ serviceId: svc.id, quantity: 1 }] })), /必须是 2 到 4/u, "低于最小数量");
  rejects(() => resolveQuoteServices([svc], ctx({ selections: [{ serviceId: svc.id, quantity: 5 }] })), /必须是 2 到 4/u, "高于最大数量");
  rejects(() => resolveQuoteServices([svc], ctx({ selections: [{ serviceId: svc.id, quantity: 2.5 }] })), /整数/u, "非整数数量");
  assert.equal(resolveQuoteServices([svc], ctx({ selections: [{ serviceId: svc.id, quantity: 3 }] })).snapshots[0].quantity, 3);
  // 同一服务重复出现两行没有业务含义，必须用数量表达。
  rejects(
    () => resolveQuoteServices([svc], ctx({ selections: [{ serviceId: svc.id, quantity: 2 }, { serviceId: svc.id, quantity: 2 }] })),
    /只能出现一行/u,
    "同一服务重复选择"
  );
  ok("数量范围：最小/最大/整数三重校验，同一服务不得重复成行");
}

// ============ 5. 条件强制：漏选必须拒绝，且标记「业务规则要求」 ============
{
  const forced = service({
    code: "OPERATOR",
    serviceType: "operator",
    selectionMode: "mandatory",
    mandatoryRule: { minRentalAmount: 800 }
  });
  // 触发条件成立却没选：必须拒绝，而不是替客户悄悄加上（需求要求客户重新确认金额与条款）。
  rejects(
    () => resolveQuoteServices([forced], ctx({ rentalAmount: 1000 })),
    /必须包含服务「操作员」|必须包含服务/u,
    "强制服务漏选"
  );
  // 触发条件不成立时不强制。
  assert.equal(resolveQuoteServices([forced], ctx({ rentalAmount: 500 })).snapshots.length, 0);
  // 选了就要标记业务规则要求，并记下触发原因。
  const picked = resolveQuoteServices([forced], ctx({ rentalAmount: 1000, selections: [{ serviceId: forced.id, quantity: 1 }] }));
  assert.equal(picked.snapshots[0].requiredByRule, true, "强制服务必须标记业务规则要求，不得显示为客户自愿选择");
  assert.match(picked.snapshots[0].mandatoryRuleHit, /达到 800/u, "必须记下按哪条规则强制");
  // 不适用的强制服务不参与强制（比如只对企业强制，本单是个人）。
  const corporateOnly = service({ code: "CORP", selectionMode: "mandatory", customerScope: "corporate", mandatoryRule: { minRentalAmount: 1 } });
  assert.equal(resolveQuoteServices([corporateOnly], ctx({ rentalAmount: 1000 })).snapshots.length, 0);
  ok("条件强制：触发即必须包含并标记业务规则要求；不触发或不适用时不强制");
}

// ============ 6. 触发规则的三个维度与「留空即不限制」 ============
{
  assert.equal(mandatoryRuleHit(undefined, { itemGroupIds: ["g1"], fulfillmentMode: "delivery", rentalAmount: 1 }), undefined, "没有规则就不触发");
  assert.equal(mandatoryRuleHit({}, { itemGroupIds: ["g1"], fulfillmentMode: "delivery", rentalAmount: 1 }), undefined, "空规则不触发，不得变成无条件强制");
  assert.match(mandatoryRuleHit({ itemGroupIds: ["g1"] }, { itemGroupIds: ["g1"], fulfillmentMode: "x", rentalAmount: 0 }), /命中指定商品/u);
  assert.match(mandatoryRuleHit({ fulfillmentModes: ["delivery"] }, { itemGroupIds: [], fulfillmentMode: "delivery", rentalAmount: 0 }), /命中履约方式/u);
  assert.equal(mandatoryRuleHit({ itemGroupIds: ["other"] }, { itemGroupIds: ["g1"], fulfillmentMode: "x", rentalAmount: 0 }), undefined);
  ok("触发规则：商品、履约方式、最低租金三维度，留空即不限制");
}

// ============ 7. 损坏免赔不冒充保险，未接 Provider 不显示已投保 ============
{
  const waiver = service({ code: "WAIVER", serviceType: "damage_waiver", coverageLimit: 5000, deductible: 200 });
  const waiverSnap = resolveQuoteServices([waiver], ctx({ selections: [{ serviceId: waiver.id, quantity: 1 }] })).snapshots[0];
  assert.equal(waiverSnap.insuredDisplayable, false, "损坏免赔不得显示为已投保");
  assert.equal(waiverSnap.insuranceProviderStatus, undefined, "损坏免赔不得带保险服务商状态");
  assert.equal(waiverSnap.insuranceProviderName, undefined, "损坏免赔不得带保险服务商名称");
  assert.equal(waiverSnap.coverageLimit, 5000, "免赔的保障上限与自付额必须固化，供事后认定客户承担金额");
  assert.equal(waiverSnap.deductible, 200);

  const placeholder = service({ code: "INS", serviceType: "insurance", insuranceProviderStatus: "reserved", insuranceProviderName: "占位保险" });
  const insSnap = resolveQuoteServices([placeholder], ctx({ selections: [{ serviceId: placeholder.id, quantity: 1 }] })).snapshots[0];
  assert.equal(insSnap.insuredDisplayable, false, "未接入真实服务商时保险占位同样不得显示已投保");
  assert.equal(insSnap.insuranceProviderStatus, "reserved", "保险占位必须如实记录接入状态");
  // 存量脏数据兜底：即使库里有一条 damage_waiver 带着保险服务商（saveService 现在会拒，
  // 但历史行可能已经存在），快照也必须把它剥掉——否则页面照样会把免赔显示成保险。
  const dirtyWaiver = service({
    code: "DIRTY",
    serviceType: "damage_waiver",
    insuranceProviderStatus: "simulated",
    insuranceProviderName: "某保险公司"
  });
  const dirtySnap = resolveQuoteServices([dirtyWaiver], ctx({ selections: [{ serviceId: dirtyWaiver.id, quantity: 1 }] })).snapshots[0];
  assert.equal(dirtySnap.insuranceProviderStatus, undefined, "非保险类服务的保险服务商状态必须在快照里被剥掉");
  assert.equal(dirtySnap.insuranceProviderName, undefined, "非保险类服务的保险服务商名称必须在快照里被剥掉");
  // 取值域里根本没有「已投保」：契约层面就不可能被误用。
  const { RENTAL_INSURANCE_PROVIDER_STATUSES } = require("../packages/shared/dist/index.js");
  assert.deepEqual([...RENTAL_INSURANCE_PROVIDER_STATUSES], ["simulated", "reserved"], "接入状态不得包含「已投保」之类取值");
  ok("保障边界：损坏免赔不带保险服务商（含脏数据兜底），保险占位不显示已投保");
}

// ============ 8. 四品类复用同一模型：判定不看品类编码 ============
{
  // 同一份服务定义换四个品类的 categoryCode，判定结果必须完全一致。
  const results = ["camping", "camera", "vehicle", "construction"].map((categoryCode) => {
    const svc = service({ code: "SHARED", categoryCode, price: 30, billingUnit: "per_day" });
    return resolveQuoteServices([svc], ctx({ selections: [{ serviceId: svc.id, quantity: 1 }] })).totalAmount;
  });
  assert.deepEqual(results, [90, 90, 90, 90], "四品类必须复用同一服务模型，判定与计价不得按品类分支");
  ok("四品类复用：同一服务定义在四个品类下结果一致");
}

console.log("\nMKT-02A 增值服务目录与条款快照专项：全部通过");
