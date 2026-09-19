const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { NotificationDeliveryUnknownError } = require("../apps/api/src/modules/integrations/tenant-integration.runtime.service");
const { createAbsorbingConfigStore, createAbsorbingFactStore, createAbsorbingBusinessConfigStore, createAbsorbingBusinessFactStore } = require("./helpers/absorbing-config-store.cjs");

// NOTICE 投递租约与回执轮询：不连库，用一个带租约语义的内存事实 store 复刻仓储行为。
// 目标：认领不消耗 attempts；崩溃留下的租约到期后回到队列；达到上限不再停留在 queued；
// pollNotificationReceipts 把 sent 行按服务商回执落成 delivered / delivery_failed。

const tenantId = "tenant_002";
const core = new RentalCoreService(createAbsorbingConfigStore(), createAbsorbingFactStore());

function createLeaseFactStore() {
  const rows = new Map();
  const base = createAbsorbingBusinessFactStore();
  const toRecord = (row) => ({ log: { ...row.log }, recipientEncrypted: row.recipientEncrypted, maxAttempts: row.log.maxAttempts ?? 3 });
  return {
    ...base,
    rows,
    insertNotificationLog: async (log, _tx, recipientEncrypted) => {
      rows.set(log.id, { log: { ...log }, recipientEncrypted, leaseUntil: null });
      return "inserted";
    },
    reserveSmsRate: async () => ({ allowed: true, retryAt: new Date().toISOString() }),
    releaseSmsRate: async () => undefined,
    findNotificationDelivery: async (_tenantId, id) => (rows.has(id) ? toRecord(rows.get(id)) : undefined),
    listDueNotificationDeliveries: async (_tenantId, at, limit) => {
      const now = new Date(at).getTime();
      return [...rows.values()]
        .filter((row) => row.log.channel === "sms" && ["queued", "failed"].includes(row.log.status))
        .filter((row) => row.log.nextAttemptAt && new Date(row.log.nextAttemptAt).getTime() <= now)
        .filter((row) => !row.leaseUntil || new Date(row.leaseUntil).getTime() <= now)
        .filter((row) => row.log.attempts < (row.log.maxAttempts ?? 3))
        .slice(0, limit)
        .map(toRecord);
    },
    claimNotificationDelivery: async (_tenantId, id, at, leaseUntil, force) => {
      const row = rows.get(id);
      if (!row || !["queued", "failed", "delivery_failed"].includes(row.log.status)) return false;
      if (row.log.attempts >= (row.log.maxAttempts ?? 3)) return false;
      const atMs = new Date(at).getTime();
      if (!force && row.log.nextAttemptAt && new Date(row.log.nextAttemptAt).getTime() > atMs) return false;
      if (!force && row.leaseUntil && new Date(row.leaseUntil).getTime() > atMs) return false;
      row.leaseUntil = leaseUntil;
      row.log.lastAttemptAt = at;
      return true;
    },
    updateNotificationDelivery: async (_tenantId, id, patch) => {
      const row = rows.get(id);
      if (!row) return undefined;
      for (const key of ["status", "provider", "providerMessageId", "errorMessage", "sentAt", "nextAttemptAt", "lastAttemptAt"]) {
        if (patch[key] !== undefined) row.log[key] = patch[key] === null ? undefined : patch[key];
      }
      if (patch.countAttempt) row.log.attempts += 1;
      if (patch.countAttempt || patch.releaseLease) row.leaseUntil = null;
      return { ...row.log };
    },
    listSentNotificationDeliveries: async (_tenantId, _workspaceId, take) =>
      [...rows.values()].filter((row) => ["sent", "delivery_pending"].includes(row.log.status) && row.log.providerMessageId && row.recipientEncrypted).slice(0, take).map(toRecord)
  };
}

const runtime = {
  mode: "fail",
  sendCalls: 0,
  queries: new Map(),
  hasEnabledProvider: async () => true,
  sendNotificationSms: async () => {
    runtime.sendCalls += 1;
    if (runtime.mode === "fail") throw new Error("provider down");
    if (runtime.mode === "hang") return new Promise(() => undefined);
    return { configured: true, provider: "aliyun_sms", externalRequestId: `biz-${runtime.sendCalls}` };
  },
  queryNotificationDelivery: async (_tenantId, _phone, messageId) => {
    const answer = runtime.queries.get(messageId);
    if (answer instanceof Error) throw answer;
    return answer ?? { status: "pending", providerStatus: "WAITING" };
  }
};
const secretBox = {
  encrypt: (value) => `enc:${JSON.stringify(value)}`,
  decrypt: (value) => JSON.parse(value.slice(4)),
  fingerprint: (value) => `fp:${value}`
};

function context() {
  const profile = core.getProfile(tenantId);
  return {
    profile,
    category: core.listCategories().find((item) => item.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId),
    operators: core.listOperators(tenantId)
  };
}

void (async () => {
  const ok = (message) => console.log(`  PASS  ${message}`);
  const factStore = createLeaseFactStore();
  const business = new RentalBusinessService(
    createAbsorbingBusinessConfigStore(), factStore, createAbsorbingConfigStore(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, runtime, secretBox
  );
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();
  const workspaceId = business.workspaceOf(tenantId);

  const template = business.listNotificationTemplates(tenantId, context()).find((item) => item.eventCode === "order.created" && item.channel === "sms")
    ?? business.listNotificationTemplates(tenantId, context()).find((item) => item.eventCode === "order.created");
  assert.ok(template, "必须存在订单创建通知模板");
  template.channel = "sms";
  template.providerTemplateCode = "SMS_TEST_001";
  const variables = Object.fromEntries(Object.keys(template.variableSchema).map((key) => [key, `v-${key}`]));

  // 1. 首次投递失败：attempts 只在记录结果时 +1，租约随之释放，安排下一次重试。
  runtime.mode = "fail";
  const first = await business.sendNotification(tenantId, context(), { templateId: template.id, recipient: "13800001111", variables });
  assert.equal(first.status, "failed");
  assert.equal(first.attempts, 1, "记录失败结果时 attempts 递增一次");
  assert.ok(first.nextAttemptAt, "未达上限时必须安排下一次重试");
  assert.equal(factStore.rows.get(first.id).leaseUntil, null, "记录结果后租约释放");
  ok("投递结果落库时才递增 attempts，且释放租约");

  // 2. 认领只占租约、不消耗 attempts；租约期内不再出现在到期列表，到期后自动回来。
  const row = factStore.rows.get(first.id);
  row.log.nextAttemptAt = new Date(Date.now() - 1000).toISOString();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 10 * 60 * 1000);
  assert.equal(await factStore.claimNotificationDelivery(tenantId, first.id, now.toISOString(), leaseUntil.toISOString(), false), true);
  assert.equal(row.log.attempts, 1, "认领不消耗 attempts（模拟认领后进程崩溃）");
  assert.equal(row.leaseUntil, leaseUntil.toISOString());
  assert.equal((await factStore.listDueNotificationDeliveries(tenantId, now.toISOString(), 10)).length, 0, "租约期内不重复认领");
  assert.equal(await factStore.claimNotificationDelivery(tenantId, first.id, now.toISOString(), leaseUntil.toISOString(), false), false, "未到期租约不能被非强制认领覆盖");
  const afterLease = new Date(leaseUntil.getTime() + 1000).toISOString();
  assert.equal((await factStore.listDueNotificationDeliveries(tenantId, afterLease, 10)).length, 1, "租约到期后回到待投递队列");
  assert.equal(row.log.attempts, 1, "崩溃期间 attempts 没有被消耗");
  ok("认领只写租约，崩溃不吃掉重试次数，租约到期即可再认领");

  // 3. 达到 maxAttempts：状态 failed + 原因注明耗尽，nextAttemptAt 清空，不再停留在 queued。
  row.leaseUntil = null;
  await business.retryNotification(tenantId, context(), first.id);
  assert.equal(factStore.rows.get(first.id).log.attempts, 2);
  const last = await business.retryNotification(tenantId, context(), first.id);
  assert.equal(last.attempts, 3);
  assert.equal(last.status, "failed");
  assert.match(last.errorMessage, /已达最大重试次数\(3\)/u);
  assert.equal(last.nextAttemptAt, undefined, "耗尽后不再安排自动重试");
  assert.equal((await factStore.listDueNotificationDeliveries(tenantId, afterLease, 10)).length, 0);
  await assert.rejects(() => business.retryNotification(tenantId, context(), first.id), /最大重试次数/u);
  ok("达到上限后明确落为 failed 并说明原因，不会静默卡在队列里");

  // 4. 回执轮询：sent 行按服务商回执落成 delivered / delivery_failed；查询未知记 delivery_uncertain。
  runtime.mode = "ok";
  const sentA = await business.sendNotification(tenantId, context(), { templateId: template.id, recipient: "13800002222", variables });
  const sentB = await business.sendNotification(tenantId, context(), { templateId: template.id, recipient: "13800003333", variables });
  const sentC = await business.sendNotification(tenantId, context(), { templateId: template.id, recipient: "13800004444", variables });
  const sentD = await business.sendNotification(tenantId, context(), { templateId: template.id, recipient: "13800005555", variables });
  for (const item of [sentA, sentB, sentC, sentD]) {
    assert.equal(item.status, "sent");
    assert.equal(item.attempts, 1);
    assert.ok(item.providerMessageId);
  }
  runtime.queries.set(sentA.providerMessageId, { status: "delivered", providerStatus: "DELIVRD" });
  runtime.queries.set(sentB.providerMessageId, { status: "failed", providerStatus: "UNDELIV", detail: "号码停机" });
  runtime.queries.set(sentC.providerMessageId, new NotificationDeliveryUnknownError("查询超时"));
  const polled = await business.pollNotificationReceipts(tenantId, workspaceId, 50);
  assert.equal(polled.polled, 4);
  assert.equal(polled.delivered, 1);
  assert.equal(polled.deliveryFailed, 1);
  assert.equal(polled.pending, 1);
  assert.equal(polled.uncertain, 1);
  assert.equal(factStore.rows.get(sentA.id).log.status, "delivered");
  assert.equal(factStore.rows.get(sentB.id).log.status, "delivery_failed");
  assert.equal(factStore.rows.get(sentB.id).log.errorMessage, "号码停机");
  assert.equal(factStore.rows.get(sentC.id).log.status, "delivery_uncertain");
  assert.equal(factStore.rows.get(sentD.id).log.status, "delivery_pending");
  assert.equal(factStore.rows.get(sentA.id).log.attempts, 1, "回执查询不消耗投递尝试次数");
  const again = await business.pollNotificationReceipts(tenantId, workspaceId, 50);
  assert.equal(again.polled, 1, "已有最终回执/不确定态的行不再轮询，只剩 delivery_pending");
  ok("pollNotificationReceipts 按服务商回执落 delivered / delivery_failed，未知保持不确定态");

  console.log("NOTICE 投递租约与回执轮询：4 项通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
