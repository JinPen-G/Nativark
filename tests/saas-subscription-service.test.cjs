const test = require("node:test");
const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { SubscriptionService } = require("../apps/api/src/modules/subscription/subscription.service");
const { validateSync } = require("class-validator");
const dto = require("../apps/api/src/modules/subscription/subscription-request.dto");
const shared = require("@rental-os/shared");
const db = require("@prisma/client");
const NOW = new Date("2026-06-01T00:00:00Z");
const clone = (x) => structuredClone(x);
const subscription = (extra = {}) => ({ id: "sub", tenantId: "t1", revision: 1, plan: "PRO", source: "HISTORICAL_REGISTER", startAt: new Date("2026-01-01T00:00:00Z"), endAt: new Date("2027-01-01T00:00:00Z"), serviceTimeZone: "UTC", billingAnniversary: new Date("2026-01-01T00:00:00Z"), currentAmount: 500, currentCurrency: "CNY", currentTaxInclusive: true, sourceReason: null, handledAt: NOW, ...extra });
const segment = (extra = {}) => ({ id: "next", tenantId: "t1", status: "SCHEDULED", plan: "STANDARD", source: "HISTORICAL_REGISTER", startAt: new Date("2027-01-01T00:00:00Z"), endAt: new Date("2028-01-01T00:00:00Z"), amount: 300, currency: "CNY", taxInclusive: false, billingAnniversary: new Date("2026-01-01T00:00:00Z"), reason: null, createdAt: NOW, ...extra });
function fixture(initial = subscription()) {
  const state = { tenants: [{ id: "t1", name: "租户", code: "one" }, { id: "t2", name: "未配置", code: "two" }], subscriptions: initial ? [initial] : [], segments: [], requests: [], events: [], features: [], grants: [], prices: [] };
  let seq = 0;
  const queries = [];
  function match(row, where = {}) {
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      if (k === "OR") return v.some((part) => match(row, part));
      if (k === "AND") return v.every((part) => match(row, part));
      if (k.includes("_") && !(k in row)) return match(row, v);
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if (v.in) return v.in.includes(row[k]);
        if (v.lte) return row[k] <= v.lte;
      }
      return v instanceof Date ? row[k]?.getTime() === v.getTime() : row[k] === v;
    });
  }
  function apply(row, data) {
    for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v && typeof v === "object" && "increment" in v ? row[k] + v.increment : clone(v);
    return row;
  }
  function model(key, defaults = {}) {
    return {
      findUnique: async ({ where }) => clone(state[key].find((r) => match(r, where)) ?? null),
      findUniqueOrThrow: async ({ where }) => { const row = state[key].find((r) => match(r, where)); if (!row) throw new Error("missing"); return clone(row); },
      findFirst: async ({ where }) => clone(state[key].find((r) => match(r, where)) ?? null),
      findMany: async ({ where } = {}) => clone(state[key].filter((r) => match(r, where))),
      create: async ({ data }) => { const row = { id: `row-${++seq}`, createdAt: NOW, updatedAt: NOW, ...clone(defaults), ...clone(data) }; state[key].push(row); return clone(row); },
      update: async ({ where, data }) => { const row = state[key].find((r) => match(r, where)); if (!row) throw new Error("missing"); return clone(apply(row, data)); },
      updateMany: async ({ where, data }) => { const rows = state[key].filter((r) => match(r, where)); rows.forEach((r) => apply(r, data)); return { count: rows.length }; },
      upsert: async ({ where, update, create }) => { const row = state[key].find((r) => match(r, where)); if (row) return clone(apply(row, update)); return client[key].create({ data: create }); }
    };
  }
  const client = {
    tenantSubscription: model("subscriptions", { revision: 1, currentTaxInclusive: null }),
    tenantSubscriptionSegment: model("segments", { taxInclusive: null, billingAnniversary: null }),
    subscriptionRequest: model("requests", { handledAmount: null, handledCurrency: null, handledTaxInclusive: null, targetPlan: null, timeline: [], publicReason: null, linkedEventId: null, periodText: null }),
    subscriptionEvent: model("events"), subscriptionFeatureCatalog: model("features"), tenantFeatureGrant: model("grants"), subscriptionStandardPrice: model("prices"),
    tenant: {
      findUnique: async ({ where }) => { const tenant = state.tenants.find((r) => match(r, where)); return tenant ? { ...clone(tenant), subscription: clone(state.subscriptions.find((r) => r.tenantId === tenant.id) ?? null), subscriptionSegments: clone(state.segments.filter((s) => s.tenantId === tenant.id && s.status === "SCHEDULED")) } : null; },
      findMany: async ({ where }) => Promise.all(state.tenants.filter((r) => match(r, where)).map((r) => client.tenant.findUnique({ where: { id: r.id } })))
    },
    $queryRaw: async (query, ...values) => {
      const sql = query.sql ?? query.join("?"); queries.push(sql);
      if (sql.includes("subscription_standard_prices")) return clone(state.prices);
      if (sql.includes("COUNT(*)")) return [{ total: 2n }];
      if (sql.includes("LEFT JOIN")) return state.tenants.map((r) => ({ id: r.id }));
      return state.tenants.filter((r) => r.id === values[0]).map((r) => ({ id: r.id }));
    },
    $transaction: async (work) => {
      const before = clone(state);
      try { return await work(client); }
      catch (error) { Object.assign(state, before); throw error; }
    }
  };
  return { state, client, service: new SubscriptionService(client), queries };
}
const historical = { source: "historical_register", reason: "约定服务登记" };
test("品类商业快照只使用调用者事务、最小披露并区分生效/撤销授权", async () => {
  const { service, state, client } = fixture();
  const feature = (code, releaseStatus = "RELEASED") => ({ code, name: code, module: "core", categories: ["camera"], defaultOwnership: "PRO", currentOwnership: "PRO", releaseStatus, externalFeeNote: "内部费用", valueText: "说明" });
  state.features.push(feature("public"), feature("pilot", "PILOT"), feature("future", "PILOT"), feature("revoked", "PILOT"));
  state.grants.push({ tenantId: "t1", featureCode: "pilot", effectiveAt: NOW, revokedAt: null }, { tenantId: "t1", featureCode: "future", effectiveAt: new Date(NOW.getTime() + 1), revokedAt: null }, { tenantId: "t1", featureCode: "revoked", effectiveAt: NOW, revokedAt: NOW }, { tenantId: "t2", featureCode: "future", effectiveAt: NOW, revokedAt: null });
  const before = clone(state);
  service.prisma = new Proxy({}, { get() { throw new Error("事务外读取或嵌套事务"); } });
  const result = await service.readCategoryCommercialContext("t1", client, NOW);
  assert.deepEqual(Object.keys(result).sort(), ["complete", "entitlements", "newBusinessAllowed", "revision", "scope", "serviceStatus"]);
  assert.equal(result.complete, false); assert.equal(result.newBusinessAllowed, true);
  assert.deepEqual(result.entitlements.map((r) => [r.code, r.available]), [["public", true], ["pilot", true], ["future", false], ["revoked", false]]);
  assert.deepEqual(Object.keys(result.entitlements[0]).sort(), ["available", "categories", "code"]);
  assert.doesNotMatch(JSON.stringify(result), /内部费用|currentAmount|valueText/);
  assert.deepEqual(state, before);
});

test("品类商业快照按截止边界拒绝、只读投影接续段、不擅改未配置策略", async () => {
  const { service, state, client } = fixture(subscription({ endAt: NOW }));
  assert.equal((await service.readCategoryCommercialContext("t1", client, NOW)).newBusinessAllowed, false);
  state.segments.push(segment({ startAt: NOW, endAt: new Date("2028-01-01") }));
  const before = clone(state);
  const resumed = await service.readCategoryCommercialContext("t1", client, NOW);
  assert.equal(resumed.newBusinessAllowed, true); assert.equal(resumed.revision, 2);
  assert.deepEqual(state, before, "不物化排期、不递增数据库修订");
  const unconfigured = await service.readCategoryCommercialContext("t2", client, NOW);
  assert.equal(unconfigured.serviceStatus, "unconfigured"); assert.equal(unconfigured.newBusinessAllowed, true);
});

test("商业屏障按租户再有序功能行锁，仅返回实际依赖并在锁等待后读取期限", async (t) => {
  clock(t);
  const { service, state, client } = fixture(subscription({ endAt: new Date(NOW.getTime() + 1000) }));
  state.features.push(...["a", "b", "unrelated"].map((code) => ({ code, name: code, module: "core", categories: ["camera"], currentOwnership: "STANDARD", defaultOwnership: "STANDARD", releaseStatus: "RELEASED" })));
  const locks = [];
  const before = clone(state);
  client.$queryRaw = async (query, value) => {
    assert.match(query.sql ?? query.join("?"), /FOR UPDATE/);
    locks.push(value);
    if (locks.length === 1) return [{ id: value }];
    if (value === "b") t.mock.timers.setTime(NOW.getTime() + 2000);
    return [{ code: value }];
  };
  const result = await service.lockCategoryCommercialContext("t1", client, ["b", "a", "b"]);
  assert.deepEqual(locks, ["t1", "a", "b"]);
  assert.deepEqual(result.lockedFeatureCodes, ["a", "b"]);
  assert.deepEqual(result.entitlements.map((row) => row.code), ["a", "b"]);
  assert.equal(result.newBusinessAllowed, false, "不能使用等待锁之前尚未到期的时间");
  assert.equal(result.checkedAt, new Date(NOW.getTime() + 2000).toISOString());
  assert.equal(result.complete, false);
  assert.deepEqual(state, before);
});

test("商业屏障未知或非精确目录编码拒绝、不伪造空目录授权，空依赖仍锁住期限", async () => {
  const { service, client } = fixture();
  for (const codes of [null, [""], [" a "], [1], ["x".repeat(192)]]) await assert.rejects(service.lockCategoryCommercialContext("t1", client, codes), /编码无效/);
  let mode = "missing", locks = 0;
  client.$queryRaw = async (query, value) => {
    locks++;
    if ((query.sql ?? query.join("?")).includes("FROM Tenant")) return [{ id: value }];
    return mode === "missing" ? [] : [{ code: "OTHER" }];
  };
  await assert.rejects(service.lockCategoryCommercialContext("t1", client, ["missing"]), /未登记/);
  mode = "other";
  await assert.rejects(service.lockCategoryCommercialContext("t1", client, ["other"]), /编码不一致/);
  const before = locks;
  const empty = await service.lockCategoryCommercialContext("t1", client, []);
  assert.equal(locks, before + 1); assert.deepEqual(empty.entitlements, []);
});
function clock(t, now = NOW) { t.mock.timers.enable({ apis: ["Date"], now }); }

test("等待锁跨过授权生效时点后必须拒绝旧修订", async (t) => {
  clock(t);
  const { service, state } = fixture();
  state.subscriptions[0].endAt = new Date(NOW.getTime() + 1000);
  state.segments.push(segment({ startAt: new Date(NOW.getTime() + 1000) }));
  service.lockTenant = async () => { t.mock.timers.setTime(NOW.getTime() + 2000); };
  await assert.rejects(service.scheduleNext("t1", { ...historical, plan: "standard", expectedRevision: 1, effectiveAt: "2028-01-01T00:00:00Z", serviceYears: 1 }), /已更新/);
  assert.equal(state.segments[0].status, "SCHEDULED");
});

test("合法自定义截止不被DST周年探测误拒，遗留未订阅授权可撤销", async (t) => {
  clock(t);
  const { service, state } = fixture(null);
  const input = { endAt: new Date("2027-03-15T06:30:00Z"), billingAnniversary: new Date("2026-03-14T06:30:00Z"), serviceTimeZone: "America/New_York" };
  assert.equal(service.renewalDates({ serviceYears: 1 }, input.endAt, input).end.toISOString(), "2028-03-15T06:30:00.000Z");
  state.grants.push({ id: "grant", tenantId: "t1", featureCode: "f", revokedAt: null });
  await service.revokeFeature("t1", { featureCode: "f", expectedRevision: 0, reason: "试点结束" });
  assert.ok(state.grants[0].revokedAt);
  assert.equal(service.toChangeLog(state.events[0]).reason, "试点结束");
});

test("收费不能漏商业事实，公开原因保留、平台备注仅平台可读", async (t) => {
  clock(t);
  const { service } = fixture(null);
  await assert.rejects(service.provision("t1", { source: "sale", plan: "standard", expectedRevision: 0, startAt: NOW.toISOString(), serviceYears: 1 }), /正常收费办理/);
  await service.provision("t1", { ...historical, plan: "standard", expectedRevision: 0, startAt: NOW.toISOString(), serviceYears: 1, note: "内部银行信息" });
  const tenant = await service.getTenantView("t1");
  assert.equal(tenant.changeLog[0].reason, historical.reason);
  assert.doesNotMatch(JSON.stringify(tenant), /内部银行/);
  assert.equal((await service.getTenantView("t1", true)).changeLog[0].internalNote, "内部银行信息");
});

test("所有订阅枚举 shared 与 Prisma 值逐一对应", () => {
  for (const name of ["SubscriptionPlan", "SubscriptionSource", "SubscriptionRequestStatus", "SubscriptionRequestType", "FeatureReleaseStatus", "FeatureOwnership"]) {
    assert.deepEqual(Object.values(shared[name]).sort(), Object.values(db[name]).map((s) => s.toLowerCase()).sort());
  }
});

test("续费保留当前PRO与金额，下期基础版仅在边界生效，过期后仍保留最近套餐", async (t) => {
  clock(t);
  const { service, state } = fixture();
  const result = await service.renew("t1", { ...historical, plan: "standard", serviceYears: 1, expectedRevision: 1, amount: 300, currency: "CNY", taxInclusive: false });
  assert.equal(result.plan, "pro"); assert.equal(result.currentAmount.amount, 500);
  assert.equal(result.next.plan, "standard"); assert.equal(state.subscriptions[0].revision, 2);
  assert.equal(state.segments[0].status, "SCHEDULED");
  const atBoundary = service.project(state.subscriptions[0], state.segments, new Date("2027-01-01T00:00:00Z"));
  assert.equal(atBoundary.current.plan, "STANDARD"); assert.equal(atBoundary.current.currentAmount, 300);
  assert.equal(atBoundary.current.currentTaxInclusive, false); assert.equal(atBoundary.current.revision, 3);
  assert.equal(atBoundary.next, null);
  assert.equal(service.deriveStatus(atBoundary.current, new Date("2028-01-01T00:00:00Z")), "expired");
});

test("排期空档不放行，准确生效后到期守卫使用接续段", async (t) => {
  clock(t, new Date("2027-02-01T00:00:00Z"));
  const { service, state } = fixture();
  state.segments.push(segment({ startAt: new Date("2027-03-01T00:00:00Z") }));
  await assert.rejects(service.assertTenantWithinTerm("t1"), /已到期/);
  state.segments[0].startAt = new Date("2027-01-01T00:00:00Z");
  await service.assertTenantWithinTerm("t1");
  const overview = await service.reloadOverview("t1");
  assert.equal(overview.plan, "standard"); assert.equal(overview.serviceStatus, "active");
});

test("物化到期排期使用读取的修订号，旧修订和缺修订不允许写", async (t) => {
  clock(t, new Date("2027-02-01T00:00:00Z"));
  const { service, state, client } = fixture(); state.segments.push(segment());
  await assert.rejects(service.writableState(client, "t1", 1, new Date()), /已更新/);
  await assert.rejects(service.writableState(client, "t1", undefined, new Date()), /expectedRevision/);
  const view = await service.reloadOverview("t1");
  await service.extend("t1", { endAt: "2028-02-01T00:00:00Z", reason: "协商延长", expectedRevision: view.revision });
  assert.equal(state.subscriptions[0].plan, "STANDARD"); assert.equal(state.subscriptions[0].revision, 3);
  assert.equal(state.segments[0].status, "CURRENT");
});

test("重叠排期、重复续费、临时延长覆盖下一段均拒绝且不写入", async (t) => {
  clock(t);
  const { service, state } = fixture();
  await assert.rejects(service.scheduleNext("t1", { ...historical, expectedRevision: 1, plan: "standard", effectiveAt: "2026-07-01T00:00:00Z", serviceYears: 1 }), /不得早于/);
  state.segments.push(segment());
  await assert.rejects(service.renew("t1", { ...historical, expectedRevision: 1, plan: "standard", serviceYears: 1 }), /下一段/);
  await assert.rejects(service.extend("t1", { expectedRevision: 1, endAt: "2027-02-01T00:00:00Z", reason: "延长" }), /重叠/);
  assert.equal(state.events.length, 0); assert.equal(state.subscriptions[0].revision, 1);
});

test("初次开通重试旧修订不会二次开通，未来更改不能替换当前服务", async (t) => {
  clock(t);
  const { service, state } = fixture(null);
  const request = { ...historical, expectedRevision: 0, plan: "standard", startAt: "2026-01-01T00:00:00Z", serviceYears: 1 };
  await service.provision("t1", request);
  await assert.rejects(service.provision("t1", request), /已更新/);
  await assert.rejects(service.provision("t1", { ...request, expectedRevision: 1, startAt: "2027-01-01T00:00:00Z" }), /未来套餐/);
  assert.equal(state.events.length, 1);
});

test("升级只允许有效基础版且保持统一截止，销售未开放不能收费PRO", async (t) => {
  clock(t);
  const { service, state } = fixture(subscription({ plan: "STANDARD" }));
  await service.upgradePro("t1", { ...historical, expectedRevision: 1 });
  assert.equal(state.subscriptions[0].plan, "PRO");
  assert.equal(state.subscriptions[0].endAt.toISOString(), "2027-01-01T00:00:00.000Z");
  const expired = fixture(subscription({ plan: "STANDARD", endAt: new Date("2026-05-01T00:00:00Z") }));
  await assert.rejects(expired.service.upgradePro("t1", { ...historical, expectedRevision: 1 }), /有效基础/);
  await assert.rejects(service.provision("t2", { source: "sale", expectedRevision: 0, plan: "pro", startAt: NOW.toISOString(), serviceYears: 1 }), /正式销售/);
});

test("金额、币种、税和日期必须明确，非法值不静默归空", async (t) => {
  clock(t);
  const { service } = fixture();
  for (const amount of [0, -1, NaN, Infinity, 0.001]) assert.throws(() => service.normalizeAmount(amount, "CNY"));
  assert.throws(() => service.normalizeAmount(1)); assert.throws(() => service.normalizeAmount(undefined, "CNY"));
  assert.deepEqual(service.normalizeAmount(), { amount: null, currency: null });
  assert.deepEqual(service.normalizeAmount(1.25, "usd"), { amount: 1.25, currency: "USD" });
  assert.throws(() => service.parseInstant("2026-06-01", "错误"), /时区/);
  assert.throws(() => service.resolveEnd({ serviceYears: 1, endAt: "2028-01-01" }, NOW, "UTC"), /二选一/);
  await assert.rejects(service.checkPrice({}, "standard", { ...historical, amount: 1 }), /税口径/);
});

test("申请同类型不同键去重，办理原子关联事件，跨租户或不匹配办理整段回滚", async (t) => {
  clock(t);
  const { service, state } = fixture();
  const a = await service.submitRequest("t1", { type: "renew_standard", dedupeKey: "key1" });
  const b = await service.submitRequest("t1", { type: "renew_standard", dedupeKey: "key2" });
  assert.equal(a.id, b.id);
  const request = { ...historical, expectedRevision: 1, plan: "standard", serviceYears: 1, requestId: a.id };
  await assert.rejects(service.renew("t1", { ...request, plan: "pro" }), /不一致/);
  assert.equal(state.segments.length, 0); assert.equal(state.events.length, 0); assert.equal(state.subscriptions[0].revision, 1);
  await service.renew("t1", request);
  assert.equal(state.requests[0].status, "PROCESSED"); assert.equal(state.requests[0].linkedEventId, state.events[0].id);
  await assert.rejects(service.cancelRequest("t1", a.id), /未办理/);
  const other = await service.submitRequest("t2", { type: "renew_standard", dedupeKey: "key" });
  const foreign = fixture(); foreign.state.requests.push(clone(state.requests.find((r) => r.id === other.id)));
  await assert.rejects(foreign.service.renew("t1", { ...request, requestId: other.id }), /不存在/);
  assert.equal(foreign.state.events.length, 0);
});

test("咨询与拒绝不泄露平台内部备注，授权申请不能仅点已办理", async (t) => {
  clock(t);
  const { service, state } = fixture();
  const consulting = await service.submitRequest("t1", { type: "upgrade_consult", dedupeKey: "consult" });
  const result = await service.handleRequest(consulting.id, { status: "processed", expectedRevision: 1, publicReason: "已联系", note: "内部银行信息" }, "operator");
  assert.doesNotMatch(JSON.stringify(result), /内部银行/); assert.equal(state.events[0].handlingNote, "内部银行信息");
  const request = await service.submitRequest("t1", { type: "renew_pro", dedupeKey: "renew" });
  await assert.rejects(service.handleRequest(request.id, { status: "processed", expectedRevision: 2, publicReason: "完成" }), /实际/);
  await service.cancelRequest("t1", request.id);
  await assert.rejects(service.handleRequest(request.id, { status: "rejected", expectedRevision: 2, publicReason: "拒绝" }), /关闭/);
});

test("员工视图显式脱敏，待生效PRO不授予专业功能，明确特批试点仅有效期内可用", async (t) => {
  clock(t);
  const { service, state } = fixture(subscription({ startAt: new Date("2026-07-01T00:00:00Z") }));
  state.features.push({ code: "f", name: "F", module: "M", categories: [], defaultOwnership: "PRO", currentOwnership: "PRO", releaseStatus: "RELEASED" });
  const ctx = await service.getStaffContext("t1");
  assert.equal(ctx.entitlements[0].available, false); assert.equal(ctx.reminder.stage, "none");
  assert.equal("currentAmount" in ctx.overview, false); assert.equal("handledAt" in ctx.overview, false);
  state.subscriptions[0].startAt = new Date("2026-01-01T00:00:00Z");
  state.features[0].releaseStatus = "PILOT";
  assert.equal((await service.getStaffContext("t1")).entitlements[0].available, false);
  state.grants.push({ featureCode: "f", tenantId: "t1", revokedAt: null, effectiveAt: NOW });
  assert.equal((await service.getStaffContext("t1")).entitlements[0].available, true);
  state.subscriptions[0].endAt = NOW;
  assert.equal((await service.getStaffContext("t1")).entitlements[0].available, false);
});

test("列表包含未配置租户，分页与有效段筛选发生在SQL，提醒阈值可配置", async (t) => {
  clock(t);
  const { service, queries } = fixture();
  const page = await service.listOverviews({ page: 1, pageSize: 20, keyword: "租户" });
  assert.equal(page.total, 2); assert.equal(page.items[1].serviceStatus, "unconfigured");
  assert.ok(queries.some((q) => q.includes("LEFT JOIN") && q.includes("LIMIT") && q.includes("OFFSET")));
  await assert.rejects(service.listOverviews({ pageSize: 1000 }));
  const original = process.env.SUBSCRIPTION_REMINDER_NORMAL_DAYS;
  try {
    process.env.SUBSCRIPTION_REMINDER_NORMAL_DAYS = "60";
    assert.equal(service.deriveStatus(subscription({ endAt: new Date("2026-07-20T00:00:00Z") }), NOW), "expiring");
  } finally { if (original === undefined) delete process.env.SUBSCRIPTION_REMINDER_NORMAL_DAYS; else process.env.SUBSCRIPTION_REMINDER_NORMAL_DAYS = original; }
});

test("写DTO强制修订号，金额大于零且最多两位小数", () => {
  for (const name of ["ProvisionSubscriptionDto", "RenewSubscriptionDto", "UpgradeSubscriptionProDto", "ExtendSubscriptionDto", "ScheduleNextSubscriptionDto", "HandleSubscriptionRequestDto", "GrantTenantFeatureDto", "RevokeTenantFeatureDto"]) {
    assert.ok(validateSync(new dto[name]()).some((e) => e.property === "expectedRevision"), name);
  }
  const value = Object.assign(new dto.RenewSubscriptionDto(), { ...historical, plan: "standard", expectedRevision: 1, serviceYears: 1, amount: 0 });
  assert.ok(validateSync(value).some((e) => e.property === "amount")); value.amount = 1.001;
  assert.ok(validateSync(value).some((e) => e.property === "amount")); value.amount = 1.01;
  assert.equal(validateSync(value).length, 0);
});
