const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// Codex review #7：续租新增服务只收费，没接履约。
//
// 修复前两个续租报价函数都把 resolveQuoteServices 的快照算出来、拼完费用明细就丢掉：
// 既不校验服务容量（可以给容量已满的服务加单，到履约那天没人能做），也不把快照带出去，
// 于是生效时无从占用容量、归还结算与损坏免赔认定也看不到这些服务。
//
// 这里验证三段：报价的容量闸门与快照带出、生效时并进订单快照、控制器在生效那一刻占容量。
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");
const {
  createAbsorbingConfigStore,
  createAbsorbingFactStore,
  createAbsorbingBusinessConfigStore,
  createAbsorbingBusinessFactStore
} = require("./helpers/absorbing-config-store.cjs");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

const tenantId = "tenant_002";
const now = Date.now();
const startAt = new Date(now + 2 * 86_400_000).toISOString();
const endAt = new Date(now + 5 * 86_400_000).toISOString();
const extendedTo = new Date(now + 7 * 86_400_000).toISOString();

/**
 * 记录容量调用的替身。`spy.reject = true` 之后再抛，用来验证闸门真的拦得住——
 * 夹具里的 createQuote 也走同一道闸门，一开始就抛会在建夹具时就炸掉。
 */
function capacitySpy() {
  const calls = { asserted: [], reserved: [], confirmed: [] };
  const spy = {
    calls,
    reject: false,
    assertAvailableForQuote: async (_tenantId, snapshots) => {
      calls.asserted.push(snapshots);
      if (spy.reject) throw new Error("服务容量不足");
    },
    reserveForOrder: async (_tenantId, order, requestKey) => { calls.reserved.push({ order, requestKey }); },
    confirmForOrder: async (_tenantId, orderId) => { calls.confirmed.push(orderId); }
  };
  return spy;
}

const CAPACITY_SERVICE = (id, categoryCode) => ({
  id, tenantId, categoryCode, code: "ONSITE", name: "驻场助理",
  serviceType: "other", billingUnit: "per_day", price: 100,
  minimumQuantity: 1, maximumQuantity: 5,
  applicableFulfillmentModes: [], applicableLocationIds: [], applicableItemGroupIds: [],
  customerScope: "all", selectionMode: "optional",
  termsVersion: "1.0", terms: "驻场助理服务条款。",
  requiresCapacity: true, status: "enabled", version: "1.0",
  createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
});

async function pricingFixture(spy) {
  const core = new RentalCoreService(createAbsorbingConfigStore(), createAbsorbingFactStore());
  const business = new RentalBusinessService(
    createAbsorbingBusinessConfigStore(),
    createAbsorbingBusinessFactStore(),
    createAbsorbingConfigStore(),
    undefined, undefined, undefined, undefined, undefined,
    spy
  );
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();
  const profile = core.getProfile(tenantId);
  const ctx = {
    profile,
    category: core.listCategories().find((row) => row.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId),
    pricingGroups: core.listPricingGroups(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId),
    operators: core.listOperators(tenantId)
  };
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], tenantId, 'ws_tenant_002', ctx);
  const group = ctx.groups.find((row) => row.status === "enabled") ?? ctx.groups[0];
  const location = ctx.locations.find((row) => row.status === "enabled") ?? ctx.locations[0];
  // listServices 返回的是状态里的那个数组本体，直接补一条需要容量的服务即可。
  const services = business.listServices(tenantId, ctx);
  const service = CAPACITY_SERVICE(`${tenantId}_svc_capacity`, profile.categoryCode);
  services.push(service);
  const quote = await business.createQuote(tenantId, ctx, {
    customerType: "personal", customerName: "续租服务测试", fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: location.id, startAt, endAt,
    lines: [{ itemGroupId: group.id, quantity: 1 }]
  });
  quote.ruleSnapshot.extension = { enabled: true, forceImmediateWhenOverdue: true, pricingMode: "original_total" };
  // The async quote consumer reads a durable port; this fixture supplies its
  // own frozen quote, not production cache fallback or a database-lock claim.
  business.factStore.findQuote = async (_tenant, id) => id === quote.id ? structuredClone(quote) : undefined;
  // createQuote 自己也过同一道容量闸门（本单没选服务，传的是空数组）。清掉这次记录，
  // 后面断言的才是续租那一次。
  spy.calls.asserted.length = 0;
  return {
    business, ctx, service,
    args: {
      order: { id: "order_ext_svc", startAt, endAt, quoteId: quote.id, depositAmount: quote.depositAmount, preAuthAmount: quote.preAuthAmount },
      lines: quote.request.lines.map((line) => ({ itemGroupId: line.itemGroupId, pricingGroupId: line.pricingGroupId, quantity: line.quantity })),
      appliedAt: new Date(now + 3 * 86_400_000).toISOString(),
      settlementMode: "immediate", fulfillmentMode: "store_pickup_return",
      locationIds: [location.id], customerType: "personal", newEndAt: extendedTo
    }
  };
}

void (async () => {

/* ---------- 续租报价必须过服务容量闸门，并把快照带出来 ---------- */

{
  const spy = capacitySpy();
  const { business, ctx, service, args } = await pricingFixture(spy);
  const preview = await business.quoteOrderExtension(tenantId, ctx, {
    ...args, services: [{ serviceId: service.id, quantity: 1, serviceLocationId: args.locationIds[0], scheduledStartAt: args.order.endAt, scheduledEndAt: args.newEndAt }]
  });
  assert.equal(spy.calls.asserted.length, 1, "续租报价必须校验一次服务容量——修复前一次都不校验");
  assert.equal(spy.calls.asserted[0].some((row) => row.serviceId === service.id), true, "校验的必须是本次新增的那个服务");
  assert.ok(preview.serviceSnapshots?.length, "解析出的服务快照必须带出报价——修复前直接丢弃");
  assert.equal(preview.serviceSnapshots[0].serviceId, service.id);
  assert.ok(preview.serviceAmount > 0, "服务费仍要照收，闸门不改变金额口径");
  // MKT-02C：发生项必须带「原价 / 减免 / 净额」。留 undefined 会让净额恒等于原价，
  // 按此退款就把平台自己出的优惠也退给客户。本单没有服务维度优惠，因此应是明确的 0。
  assert.equal(preview.serviceSnapshots[0].discountAllocatedAmount, 0, "减免必须是明确的 0，而不是 undefined");
  assert.equal(preview.serviceSnapshots[0].couponAllocatedAmount, 0, "券抵扣同理");
  ok("续租报价校验服务容量并带出服务快照与明确的减免口径——修复前三件都没做");
}

/* ---------- 容量不足必须拦住续租，而不是照样收钱 ---------- */

{
  const spy = capacitySpy();
  const { business, ctx, service, args } = await pricingFixture(spy);
  spy.reject = true;
  await assert.rejects(
    () => business.quoteOrderExtension(tenantId, ctx, { ...args, services: [{ serviceId: service.id, quantity: 1, serviceLocationId: args.locationIds[0], scheduledStartAt: args.order.endAt, scheduledEndAt: args.newEndAt }] }),
    /服务容量不足/u,
    "容量不足时续租报价必须失败"
  );
  ok("服务容量不足时续租被拦住，不会先收钱再发现没人能做");
}

/* ---------- 不选服务时不碰容量 ---------- */

{
  const spy = capacitySpy();
  const { business, ctx, args } = await pricingFixture(spy);
  const preview = await business.quoteOrderExtension(tenantId, ctx, args);
  assert.equal(spy.calls.asserted.length, 0, "只延长租期不该触发服务容量校验");
  assert.equal(preview.serviceSnapshots, undefined);
  ok("只延长租期的续租不碰服务容量");
}

/* ---------- 生效时把新增服务并进订单快照 ---------- */

const snapshotOf = (serviceId, scheduledStartAt, scheduledEndAt) => ({
  serviceId, serviceCode: serviceId.toUpperCase(), serviceName: serviceId, serviceType: "other",
  serviceVersion: "1.0", workspaceId: "ws_1", billingUnit: "per_day", selectionMode: "optional",
  requiredByRule: false, unitPrice: 100, quantity: 1, billingUnits: 2, amount: 200,
  formula: "100 × 1 × 2", termsVersion: "1.0", requiresCapacity: true, capacityQuantity: 1,
  scheduledStartAt, scheduledEndAt: scheduledEndAt ?? extendedTo, serviceLocationId: "loc_1"
});

const orderWithServices = (snapshots) => ({
  id: "order_ext_svc", tenantId, chargeLines: [], serviceSnapshots: snapshots,
  payableAmount: 1000, adjustmentAmount: 0, finalPayableAmount: 1000
});

const extensionWith = (id, sequence, snapshots) => ({
  id, sequence, originalEndAt: endAt, newEndAt: extendedTo,
  rentalAmount: snapshots?.length ? 0 : 200,
  serviceAmount: snapshots?.reduce((sum, row) => sum + row.amount, 0) ?? 0,
  payableAmount: snapshots?.length ? snapshots.reduce((sum, row) => sum + row.amount, 0) : 200,
  settlementMode: "immediate", ruleVersion: "1.0", serviceSnapshots: snapshots
});

const applyExtensionToOrder = async (order, extension) => {
  const svc = Object.create(RentalCoreService.prototype);
  svc.factStore = { updateExtensionPricingSnapshot: async () => {} };
  await RentalCoreService.prototype.applyExtensionTo.call(svc, order, extension, new Date(now).toISOString(), [], {});
  return order;
};

{
  const order = await applyExtensionToOrder(
    orderWithServices([snapshotOf("svc_original", startAt)]),
    extensionWith("ext_1", 1, [snapshotOf("svc_new", endAt)])
  );
  assert.deepEqual(order.serviceSnapshots.map((row) => row.serviceId), ["svc_original", "svc_new"],
    "续租新增的服务必须并进订单快照——修复前订单上永远看不到它");
  ok("续租生效时新增服务并进订单快照：归还结算与损坏免赔认定读的都是这一份");
}

{
  // MKT-02C：同一服务被续租再买一次是**两次独立发生**。早先按 serviceId 合并成一条并取
  // 时段并集，挡住了容量错放，但后一次的版本/单价/净额会覆盖前一次，账上有服务费却找不到
  // 对应那次履约承诺。现在追加两条，配对靠各自的容量依据。
  const first = { ...snapshotOf("svc_same", startAt, endAt), serviceVersion: "1.0", amount: 200 };
  const second = { ...snapshotOf("svc_same", endAt, extendedTo), serviceVersion: "2.0", amount: 350, unitPrice: 175 };
  const order = await applyExtensionToOrder(orderWithServices([first]), extensionWith("ext_2", 2, [second]));
  assert.equal(order.serviceSnapshots.length, 2, "同一服务两次发生必须各留一条，不能被按 serviceId 覆盖");
  const [original, added] = order.serviceSnapshots;
  assert.equal(original.serviceVersion, "1.0", "原订单那次的服务版本不能被续租那次改写");
  assert.equal(original.amount, 200, "原订单那次的金额不能被覆盖");
  assert.equal(original.scheduledStartAt, startAt, "原订单那次保留自己的时段，不再取并集");
  assert.equal(original.scheduledEndAt, endAt);
  assert.equal(added.serviceVersion, "2.0", "续租那次按自己的适用版本记");
  assert.equal(added.amount, 350);
  assert.equal(added.scheduledStartAt, endAt, "续租那次保留自己的时段");
  assert.equal(added.extensionSequence, 2, "续租那次要能追溯到第几次续租");
  assert.equal(added.origin, "extension");
  assert.notEqual(original.reservationKey, added.reservationKey, "两次发生的容量依据必须不同，否则仍会配对到同一条预留");
  ok("同一服务的两次发生各自独立：版本、金额、时段与容量依据都不互相覆盖");
}

{
  // 网络重试/幂等回放会带着同一批快照再进来一次，不能变成第二次履约承诺。
  const order = orderWithServices([]);
  const extension = extensionWith("ext_retry", 4, [snapshotOf("svc_retry", endAt)]);
  await applyExtensionToOrder(order, extension);
  await applyExtensionToOrder(order, extension);
  assert.equal(order.serviceSnapshots.length, 1, "同一次续租重复生效只能留一条发生项");
  assert.equal(order.serviceSnapshots[0].occurrenceId, "extension:ext_retry:svc_retry:0", "发生项标识必须稳定，重放才能去重");
  ok("同一次续租的重复生效按发生项标识去重，不会重复记一次履约承诺");
}

{
  // 同一次续租里同一个服务的两个不同时段，也必须是两条——只按 serviceId 去重会吞掉一条。
  const order = await applyExtensionToOrder(
    orderWithServices([]),
    extensionWith("ext_two_slots", 5, [snapshotOf("svc_slot", endAt, extendedTo), snapshotOf("svc_slot", startAt, endAt)])
  );
  assert.equal(order.serviceSnapshots.length, 2, "一次续租里同一服务的两个时段是两次发生");
  assert.deepEqual(order.serviceSnapshots.map((row) => row.occurrenceId),
    ["extension:ext_two_slots:svc_slot:0", "extension:ext_two_slots:svc_slot:1"],
    "同一次续租内的多条按序号区分");
  ok("一次续租内同一服务的多个时段各自成条，序号区分而不是互相覆盖");
}

{
  const order = await applyExtensionToOrder(orderWithServices(undefined), extensionWith("ext_3", 3, undefined));
  assert.equal(order.serviceSnapshots, undefined, "没有新增服务时不该给订单凭空造出快照数组");
  ok("不新增服务的续租不改动订单的服务快照");
}

/* ---------- 控制器在生效那一刻占容量 ---------- */

const NEW_SNAPSHOTS = [snapshotOf("svc_new", endAt)];

function extensionController(spy, extension) {
  const instance = Object.create(RentalCoreController.prototype);
  instance.serviceCapacities = spy;
  instance.committed = (_tenantId, value) => value;
  instance.funding = { assertExtensionPaid: async () => {} };
  instance.business = { synchronizeExtensionCoupon: async () => {} };
  instance.priceExtension = async () => ({ priced: {} });
  instance.service = {
    resolveWorkspaceId: () => "ws_1",
    getOrder: async () => ({ id: "order_ext_svc" }),
    listOrderExtensions: async () => [],
    payOrderExtension: async () => ({ order: { id: "order_ext_svc" }, extension }),
    requestOrderExtension: async () => ({ order: { id: "order_ext_svc" }, extension })
  };
  instance.idempotent = { execute: async (args) => args.run({}) };
  return instance;
}

const req = () => ({ user: { tenantId, displayName: "运营" }, headers: {} });

{
  const spy = capacitySpy();
  const extension = { ...extensionWith("ext_pay", 1, NEW_SNAPSHOTS), status: "effective", effectiveAt: new Date(now).toISOString() };
  await extensionController(spy, extension).payExtension(req(), "order_ext_svc", "ext_pay");
  assert.equal(spy.calls.reserved.length, 1, "补款生效必须占住新增服务的容量——修复前一次都不占");
  assert.equal(spy.calls.reserved[0].requestKey, "extension:ext_pay", "幂等键按续租 id，重试不会重复占用");
  assert.deepEqual(spy.calls.reserved[0].order.serviceSnapshots, NEW_SNAPSHOTS,
    "只能传本次新增的快照：传整单会按新 key 把订单原有服务再占一遍");
  assert.deepEqual(spy.calls.confirmed, ["order_ext_svc"], "预留要当场转已确认，否则 15 分钟后被过期回收");
  ok("补款生效时占住新增服务容量，且只占本次新增的那部分");
}

{
  const spy = capacitySpy();
  const extension = { ...extensionWith("ext_pending", 2, NEW_SNAPSHOTS), status: "pending_payment" };
  await extensionController(spy, extension).applyExtension(req(), "order_ext_svc", { newEndAt: extendedTo });
  assert.equal(spy.calls.reserved.length, 0, "待补款的申请不占容量：需求 4.6.9 是补款后再延长占用");
  assert.equal(spy.calls.confirmed.length, 0);
  ok("待补款的续租申请不占服务容量，与租期占用同口径");
}

{
  const spy = capacitySpy();
  const extension = { ...extensionWith("ext_monthly", 3, NEW_SNAPSHOTS), status: "effective", settlementMode: "monthly", effectiveAt: new Date(now).toISOString() };
  await extensionController(spy, extension).applyExtension(req(), "order_ext_svc", { newEndAt: extendedTo });
  assert.equal(spy.calls.reserved.length, 1, "企业月结申请即生效，这一刻就要占容量");
  assert.equal(spy.calls.reserved[0].requestKey, "extension:ext_monthly");
  ok("企业月结续租申请即生效，同一步占住服务容量");
}

{
  const spy = capacitySpy();
  const extension = { ...extensionWith("ext_plain", 4, undefined), status: "effective" };
  await extensionController(spy, extension).payExtension(req(), "order_ext_svc", "ext_plain");
  assert.equal(spy.calls.reserved.length, 0, "没有新增服务时不该碰容量");
  assert.equal(spy.calls.confirmed.length, 0, "尤其不能空调 confirmForOrder——它会确认订单上所有待确认预留");
  ok("不新增服务的续租完全不碰容量，避免误确认订单上其他预留");
}

console.log(`\n续租服务履约专项：${passed} 项全部通过`);

})();
