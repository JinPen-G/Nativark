const test = require("node:test");
const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: true, moduleTypes: { "apps/admin/src/features/subscription/*.ts": "cjs" }, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const operations = require("../apps/admin/src/features/subscription/subscriptionOperations");
const reminders = require("../apps/admin/src/features/subscription/subscriptionReminder");
const { SubscriptionService } = require("../apps/api/src/modules/subscription/subscription.service");
const { serviceDateField } = require("../apps/admin/src/features/subscription/subscriptionDateField");
const overview = { tenantId: "t1", tenantName: "租户", tenantCode: "one", plan: "standard", serviceStatus: "active", revision: 4, timeZone: "Asia/Shanghai", startAt: "2024-02-28T16:30:00.000Z", endAt: "2027-02-27T16:30:00.000Z", anniversaryAnchor: "2024-02-28T16:30:00.000Z" };
const base = { operationType: "renew", plan: "standard", source: "historical_register", timeZone: "Asia/Shanghai", startAt: "2027-02-28T00:30:00", termMode: "years", serviceYears: 1, reason: "既有合同" };

test("默认接续保留毫秒和DST重复时刻的原始时点", () => {
  for (const [endAt, timeZone] of [["2027-01-01T00:00:00.123Z", "Asia/Shanghai"], ["2026-11-01T06:30:00.000Z", "America/New_York"]]) {
    const snapshot = { ...overview, endAt, timeZone };
    const defaults = operations.initialSubscriptionAction(snapshot, "renew", Date.parse("2026-01-01"));
    const preview = operations.subscriptionTermPreview(defaults, snapshot);
    assert.equal(preview.startAt, endAt);
  }
});

test("日期控件往返保留服务本地时间、毫秒及DST原始接续，不采用浏览器时区", () => {
  for (const [endAt, timeZone] of [["2027-01-01T00:00:00.123Z", "Asia/Shanghai"], ["2026-11-01T06:30:00.000Z", "America/New_York"]]) {
    const snapshot = { ...overview, endAt, timeZone };
    const defaults = operations.initialSubscriptionAction(snapshot, "renew", Date.parse("2026-01-01"));
    const roundTrip = serviceDateField.getValueFromEvent(serviceDateField.getValueProps(defaults.startAt).value);
    assert.equal(roundTrip, defaults.startAt);
    assert.equal(operations.subscriptionTermPreview({ ...defaults, startAt: roundTrip }, snapshot).startAt, endAt);
  }
  assert.equal(serviceDateField.getValueProps(undefined).value, null);
  assert.equal(serviceDateField.getValueFromEvent(null), undefined);
});

test("长期锚点、DST非周年自定义期限与首次开通申请可办理", () => {
  const long = { ...overview, anniversaryAnchor: "2014-01-01T00:00:00Z", endAt: "2027-01-01T00:00:00Z", timeZone: "UTC" };
  assert.equal(operations.subscriptionTermPreview({ ...base, startAt: "2027-01-01T00:00:00", timeZone: "UTC" }, long).endAt, "2028-01-01T00:00:00.000Z");
  const dst = { ...overview, anniversaryAnchor: "2026-03-14T06:30:00Z", endAt: "2027-03-15T06:30:00Z", timeZone: "America/New_York" };
  assert.equal(operations.subscriptionTermPreview({ ...base, startAt: "2027-03-15T02:30:00", timeZone: dst.timeZone }, dst).endAt, "2028-03-15T06:30:00.000Z");
  const request = { id: "r-new", type: "renew_standard", status: "pending", targetPlan: "standard" };
  const fresh = { ...overview, startAt: undefined, endAt: undefined, revision: 0, serviceStatus: "unconfigured" };
  assert.equal(operations.operationForRequest(request, fresh), "activate");
  const action = operations.buildSubscriptionAction({ ...base, operationType: "activate" }, fresh, request);
  assert.equal(action.payload.requestId, "r-new");
  assert.equal(operations.operationForRequest({ ...request, type: "upgrade_pro" }, { ...overview, serviceStatus: "expired" }), "activate");
});

test("表单续期预览保留原本地闰日锚点且与后端一致", () => {
  const preview = operations.subscriptionTermPreview(base, overview);
  assert.equal(preview.endAt, "2028-02-28T16:30:00.000Z");
  const service = new SubscriptionService({});
  const result = service.renewalDates(base, new Date(preview.startAt), { endAt: new Date(overview.endAt), billingAnniversary: new Date(overview.anniversaryAnchor), serviceTimeZone: overview.timeZone });
  assert.equal(result.end.toISOString(), preview.endAt);
});

test("临时延长后的非周年截止不错误套用原计费锚点", () => {
  const extended = { ...overview, endAt: "2027-03-09T16:30:00.000Z" };
  const values = { ...base, startAt: "2027-03-10T00:30:00" };
  const preview = operations.subscriptionTermPreview(values, extended);
  assert.equal(preview.endAt, "2028-03-09T16:30:00.000Z");
  const result = new SubscriptionService({}).renewalDates(values, new Date(extended.endAt), { endAt: new Date(extended.endAt), billingAnniversary: new Date(overview.anniversaryAnchor), serviceTimeZone: overview.timeZone });
  assert.equal(result.end.toISOString(), preview.endAt);
});

test("服务时区转换拒绝DST不存在时刻；重复时刻选择最早时点", () => {
  assert.throws(() => operations.serviceTimeToIso("2026-03-08T02:30:00", "America/New_York"), /不存在/);
  assert.equal(operations.serviceTimeToIso("2026-11-01T01:30:00", "America/New_York"), "2026-11-01T05:30:00.000Z");
  assert.throws(() => operations.serviceTimeToIso("2026-02-30T10:00:00", "Asia/Shanghai"), /无效/);
});

test("办理payload使用打开表单时的修订，续费关联真实申请", () => {
  const request = { id: "r1", type: "renew_standard", targetPlan: "standard", status: "pending" };
  const action = operations.buildSubscriptionAction(base, overview, request);
  assert.equal(action.operation, "renew"); assert.equal(action.payload.expectedRevision, 4); assert.equal(action.payload.requestId, "r1");
  assert.equal(action.payload.amount, undefined);
  assert.throws(() => operations.buildSubscriptionAction(base, { ...overview, revision: undefined }), /修订/);
  assert.throws(() => operations.buildSubscriptionAction({ ...base, plan: "pro" }, overview, request), /目标/);
});

test("金额币种税价版本和期限互斥均校验；临时延长不发送钱款", () => {
  for (const money of [{ amount: 0 }, { amount: 1, currency: "" }, { amount: 1, currency: "CNY" }, { amount: 1.001, currency: "CNY", taxInclusive: true }]) {
    assert.throws(() => operations.buildSubscriptionAction({ ...base, ...money }, overview));
  }
  assert.throws(() => operations.buildSubscriptionAction({ ...base, source: "sale", amount: 1, currency: "CNY", taxInclusive: true }, overview), /价格版本/);
  const sale = operations.buildSubscriptionAction({ ...base, source: "sale", amount: 1, currency: "CNY", taxInclusive: true, priceVersion: "v1" }, overview);
  assert.equal(sale.payload.priceVersion, "v1");
  assert.throws(() => operations.subscriptionTermPreview({ ...base, endAt: "2028-01-01T10:00:00" }, overview), /二选一/);
  const extension = operations.buildSubscriptionAction({ ...base, operationType: "extend", endAt: "2028-01-01T10:00:00", amount: 100, currency: "CNY" }, overview);
  assert.equal(extension.payload.amount, undefined); assert.equal(extension.payload.expectedRevision, 4);
});

test("处理申请不能跳过授权；撤销只允许持权待处理，拒绝需公开原因", () => {
  const request = { id: "r1", type: "renew_pro", targetPlan: "pro", status: "pending" };
  assert.equal(operations.canCancelRequest(request, true), true);
  assert.equal(operations.canCancelRequest(request, false), false);
  assert.equal(operations.canCancelRequest({ ...request, status: "processed" }, true), false);
  assert.throws(() => operations.requestHandlingPayload(request, "processed", 4, "完成"), /实际授权/);
  assert.throws(() => operations.requestHandlingPayload(request, "rejected", 4, " "), /原因/);
  assert.deepEqual(operations.requestHandlingPayload({ ...request, type: "no_renew" }, "processed", 4, "  已登记  "), { status: "processed", expectedRevision: 4, publicReason: "已登记" });
});

test("公共下放和租户特批不重复作为升级卖点，规划与试点分开展示", () => {
  const group = operations.groupSubscriptionFeatures([
    { code: "public", source: "standard_public", releaseStatus: "released" }, { code: "grant", source: "tenant_grant", releaseStatus: "released" },
    { code: "upgrade", source: "needs_upgrade", releaseStatus: "released" }, { code: "plan", source: "needs_upgrade", releaseStatus: "planned" },
    { code: "trial", source: "pro", releaseStatus: "pilot" }
  ]);
  assert.deepEqual(group.included.map((f) => f.code), ["public", "grant"]);
  assert.deepEqual(group.additional.map((f) => f.code), ["upgrade"]);
  assert.equal(group.planned.length, 1); assert.equal(group.pilot.length, 1);
});

test("提醒持久关闭按身份修订阶段自然日隔离，失败的存储不会崩溃", () => {
  const identity = { accountId: "u1", tenantId: "t1" };
  const facts = { revision: 4, plan: "standard", serviceStatus: "expiring", endAt: "2026-10-10T00:00:00Z", stage: "normal", timeZone: "Asia/Shanghai", hasOpenRequest: false };
  const now = Date.parse("2026-09-29T15:59:59Z");
  const key = reminders.reminderDismissalKey(identity, facts, now);
  const map = new Map(); const storage = { getItem: (k) => map.get(k), setItem: (k,v) => map.set(k,v) };
  reminders.dismissReminder(storage, key); assert.equal(reminders.reminderIsDismissed(storage, key), true);
  for (const [who, value, at] of [
    [{ ...identity, accountId: "u2" }, facts, now], [{ ...identity, tenantId: "t2" }, facts, now],
    [identity, { ...facts, revision: 5 }, now], [identity, { ...facts, stage: "urgent" }, now], [identity, facts, now + 1000]
  ]) assert.notEqual(reminders.reminderDismissalKey(who, value, at), key);
  assert.equal(reminders.reminderDismissalKey(identity, { ...facts, stage: "none" }, now), null);
  const throwing = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.equal(reminders.reminderIsDismissed(throwing, key), false); reminders.dismissReminder(throwing, key);
});
