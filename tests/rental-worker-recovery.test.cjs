"use strict";
/** 原 worker/权威/通知仓储/支付执行器的离线收尾闭包。只有存储与运输为内存参加者，不启动定时器或外部连接。 */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
require("ts-node").register({ transpileOnly: true, compilerOptions: {
  target: "ES2022", module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { createRentalWorkerAuthority } = require("../packages/rental-core/src/application-worker-authority");
const { createRentalApplicationParticipants, RENTAL_APPLICATION_JOB_DESCRIPTORS } = require("../packages/rental-core/src/application-participants");
const { RentalCoreFactRepository } = require("../packages/rental-core/src/mysql-core-facts");
const { RentalCoreConfigRepository } = require("../packages/rental-core/src/mysql-core-configuration");
const { RentalBusinessConfigRepository } = require("../packages/rental-core/src/mysql-business-configuration");
const { lockActiveCategoryBinding } = require("../packages/rental-core/src/mysql-category-write");
const { assertScopedWrite, resolveScopeWorkspaceId } = require("../packages/rental-core/src/mysql-workspace-scope");
const { RENTAL_CATEGORY_DEFINITIONS } = require("../packages/rental-core/src/contracts");
const { RentalBusinessFactRepository } = require("../packages/rental-core/src/mysql-business-facts");
const { RentalBusinessService } = require("../packages/rental-core/src/mysql-business-runtime");
const { PaymentRuntimeService } = require("../packages/rental-core/src/mysql-payment-runtime");
const { RentalIdempotentActionService } = require("../packages/rental-core/src/mysql-idempotent-actions");
const { getRequestIdentity, getRequestWorkspaceId, runWithRequestIdentity } = require("@rental-os/platform-server/request-identity");
const { coreBindingScopeKey } = require("@rental-os/core-host");
const { createMysqlCoreDeploymentAdmission } = require("@rental-os/core-host/mysql-deployment-admission");
const { PrismaClientKnownRequestError } = require("@prisma/client/runtime/library");
const { NotificationDeliveryUnknownError } = require("@rental-os/platform-server/notification-delivery");

const tenantId = "tenant-worker", workspaceId = "workspace-worker";
const category = RENTAL_CATEGORY_DEFINITIONS.find(value => value.code === "camping");
const scopeHash = createHash("sha256").update(coreBindingScopeKey({ coreId: "rental", tenantId,
  container: { type: "rental-workspace", id: workspaceId } })).digest("hex");
const request = (jobId, orderId) => ({ ...RENTAL_APPLICATION_JOB_DESCRIPTORS.find(job => job.id === jobId),
  jobId, tenantId, workspaceId, ...(orderId === undefined ? {} : { orderId }) });
const copy = value => value == null ? value : structuredClone(value);
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const denied = error => error?.code === "denied" || error?.code === "core_unavailable" || [403, 409].includes(error?.status);
const matches = (row, where) => Boolean(row) && Object.entries(where ?? {}).every(([key, expected]) => {
  if (key === "OR") return expected.some(part => matches(row, part));
  if (expected instanceof Date) return row[key]?.getTime() === expected.getTime();
  if (expected && typeof expected === "object") {
    if ("in" in expected) return expected.in.includes(row[key]);
    if ("not" in expected) return row[key] !== expected.not;
    if ("lte" in expected) return row[key] != null && row[key] <= expected.lte;
    if ("lt" in expected) return row[key] != null && row[key] < expected.lt;
    if ("gt" in expected) return row[key] != null && row[key] > expected.gt;
  }
  return row[key] === expected;
});
const change = (row, data) => { for (const [key, value] of Object.entries(data)) {
  if (value && typeof value === "object" && "increment" in value) row[key] += value.increment;
  else if (value && typeof value === "object" && "decrement" in value) row[key] -= value.decrement;
  else row[key] = copy(value);
} };

function fixture() {
  const f = { sequence: 0, trace: [], sends: 0, queries: 0, closes: 0, funding: 0, commands: [], termCalls: 0,
    refreshReasons: [], couponContextSuppliers: [], contextReads: 0,
    tenantStatus: "ACTIVE", workspaceStatus: "ACTIVE", grant: "disabled", gate: true, deployed: true, configured: true, admission: "accepting",
    binding: { bindingId: "original-binding", revision: 1, dataVersion: "0.1.0", containerType: "rental-workspace", containerId: workspaceId },
    orders: new Map(), notifications: new Map(), buckets: new Map(), intents: new Map(), events: new Map(), receipts: new Map(), held: new Set() };
  const record = (tx, kind, value) => f.trace.push({ tx: tx?.id ?? "root", kind, value });
  const closeReceipts = new Map();
  const tables = tx => ({
    externalAdapterLog: {
      findUnique: async ({ where }) => copy(closeReceipts.get(where.id) ?? null),
      create: async ({ data }) => {
        assert.equal(closeReceipts.has(data.id), false);
        closeReceipts.set(data.id, copy(data));
        return copy(data);
      },
      updateMany: async ({ where, data }) => {
        const row = closeReceipts.get(where.id);
        if (!row || !matches(row, where)) return { count: 0 };
        change(row, data);
        return { count: 1 };
      }
    },
    businessWorkspace: { findFirst: async ({ where }) => matches({ id: workspaceId, tenantId }, where) ? { id: workspaceId, tenantId, defaultMarker: "default" } : null },
    rentalCategoryVersion: { findUnique: async () => ({ categoryCode: "camping", structureVersion: 1, status: "legacy_baseline", definition: copy(category) }) },
    tenantRentalProfile: { findUnique: async () => f.configured ? { tenantId, categoryCode: "camping", capabilities: [], terminology: copy(category.terminology),
      configVersion: "original", initializedAt: new Date(), updatedAt: new Date() } : null },
    rentalTenantBusinessSettings: { findFirst: async () => ({ settings: { tenantId, categoryCode: "camping" } }) },
    ...Object.fromEntries(["rentalFulfillmentOperator", "rentalFulfillmentLocation", "rentalItemGroup", "rentalPricingGroup", "rentalCouponTemplate", "rentalInspectionTemplate"]
      .map(table => [table, { findMany: async () => [] }])),
    rentalNotificationLog: {
      findFirst: async ({ where }) => copy([...f.notifications.values()].find(row => matches(row, where)) ?? null),
      findMany: async ({ where, take }) => [...f.notifications.values()].filter(row => matches(row, where)).slice(0, take).map(copy),
      create: async ({ data }) => {
        if ([...f.notifications.values()].some(row => data.idempotencyKey && row.idempotencyKey === data.idempotencyKey)) {
          throw new PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "offline" });
        }
        const row = { revision: 1, leaseUntil: null, ...copy(data) }; f.notifications.set(row.id, row); record(tx, "notification-create", row.id); return copy(row);
      },
      updateMany: async ({ where, data }) => {
        const row = [...f.notifications.values()].find(value => matches(value, where));
        if (!row) return { count: 0 };
        if (f.failResults && data.attempts?.increment) throw new Error("result storage unavailable");
        change(row, data); record(tx, "notification-update", row.status);
        if (data.status === "delivery_uncertain" && !data.attempts) tx.beganDispatch = true;
        if (data.lastAttemptAt && data.leaseUntil) await f.afterClaim?.();
        return { count: 1 };
      }
    },
    rentalNotificationRateBucket: {
      create: async ({ data }) => {
        const key = `${data.scopeKey}:${data.bucketStart.toISOString()}`;
        if (f.buckets.has(key)) throw new PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "offline" });
        const row = { count: 1, ...copy(data) }; f.buckets.set(key, row); return copy(row);
      },
      updateMany: async ({ where, data }) => {
        const row = [...f.buckets.values()].find(value => matches(value, where)); if (!row) return { count: 0 };
        change(row, data); return { count: 1 };
      }
    },
    rentalPaymentIntent: {
      findMany: async ({ where, take }) => [...f.intents.values()].filter(row => matches(row, where)).slice(0, take).map(copy),
      findFirst: async ({ where }) => copy([...f.intents.values()].find(row => matches(row, where)) ?? null),
      update: async ({ where, data }) => { const row = f.intents.get(where.id); assert.ok(row); change(row, data); record(tx, "intent-update", row.status); return copy(row); },
      updateMany: async ({ where, data }) => {
        const rows = [...f.intents.values()].filter(row => matches(row, where)); rows.forEach(row => change(row, data));
        record(tx, "intent-result", data.status); return { count: rows.length };
      }
    },
    paymentWebhookEvent: {
      findUnique: async ({ where }) => copy([...f.events.values()].find(row => matches(row, where.provider_eventId)) ?? null),
      create: async ({ data }) => { const row = { id: `event-${f.events.size}`, ...copy(data) }; f.events.set(row.id, row); return copy(row); },
      update: async ({ where, data }) => { const row = f.events.get(where.id); change(row, data); return copy(row); }
    }
  });
  const database = { ...tables(), rentalTenantBusinessSettings: { findMany: async () => [{ tenantId, workspaceId, settings: { allocation: { autoPreassign: false, autoLock: false } } }] },
    async $transaction(consume, options) {
      const tx = { id: `tx-${++f.sequence}` };
      Object.assign(tx, tables(tx), { async $queryRaw(query, ...parameters) {
        const sql = (Array.isArray(query) ? query.join("?") : query.sql).replaceAll("`", "").replace(/\s+/gu, " ");
        const values = Array.isArray(query) ? parameters : query.values;
        await f.beforeQuery?.(tx, sql, values);
        if (sql.includes("GET_LOCK")) { const acquired = !f.held.has(values[0]); if (acquired) f.held.add(values[0]); return [{ acquired: Number(acquired) }]; }
        if (sql.includes("RELEASE_LOCK")) { f.held.delete(values[0]); return [{ released: 1 }]; }
        if (sql.includes("FROM Tenant")) { record(tx, "Tenant"); return values[0] === tenantId ? [{ id: tenantId, status: f.tenantStatus }] : []; }
        if (sql.includes("FROM platform_core_access_locks")) { record(tx, "gate"); return f.gate ? [{ tenantId, coreId: "rental" }] : []; }
        if (sql.includes("FROM platform_tenant_core_grants")) { record(tx, "grant"); return f.grant == null ? [] : [{ state: f.grant, revision: 1, operationId: "grant-original" }]; }
        if (sql.includes("FROM platform_core_bindings")) { assert.equal(values[2], scopeHash); record(tx, "binding"); return f.binding ? [copy(f.binding)] : []; }
        if (sql.includes("FROM SystemParameterSet")) {
          assert.deepEqual(values, ["tenant_platform", "core-deployment-admission:rental"]);
          assert.match(sql.trim(), /versionNo = 1 LOCK IN SHARE MODE$/u); record(tx, "admission");
          return f.admission === "unknown" ? [] : [{ id: "admission", tenantId: "tenant_platform",
            module: "core-deployment-admission:rental", versionNo: 1, status: "effective",
            content: { coreId: "rental", state: f.admission, revision: 1, operationId: "original-admission" } }];
        }
        if (sql.includes("FROM rental_orders")) {
          record(tx, "Order", values); const where = Object.fromEntries([...sql.matchAll(/\b(id|tenantId|workspaceId)\s*=\s*\?/gu)].map((match, i) => [match[1], values[i]]));
          return [...f.orders.values()].filter(row => matches(row, where)).map(copy);
        }
        if (sql.includes("FROM rental_allocations")) return [];
        if (sql.includes("FROM business_workspaces")) { record(tx, "Workspace"); return [{ id: workspaceId, tenantId, status: f.workspaceStatus,
          categoryCode: "camping", categoryVersionId: "original-category", categoryAdoptionRevision: 1 }]; }
        if (sql.includes("FROM rental_payment_intents")) { record(tx, "Intent"); const row = f.intents.get(values[0]); return row?.tenantId === values[1] ? [copy(row)] : []; }
        throw new Error(`unexpected SQL ${sql}`);
      } });
      // 外层仅持命名锁；短事务的原子性用原始行快照表示，外层失败不能抹除已提交短事务。
      const snapshot = options?.timeout ? undefined : Object.fromEntries(["orders", "notifications", "buckets", "intents", "events", "receipts"].map(key => [key, copy(f[key])]));
      let result;
      try { result = await consume(tx); }
      catch (error) { if (snapshot) Object.assign(f, snapshot); throw error; }
      if (tx.beganDispatch && f.loseBeginResponse) throw new Error("begin commit response unknown");
      return result;
    }
  };
  f.database = database;
  const configuration = new RentalCoreConfigRepository(database, {});
  f.authority = createRentalWorkerAuthority({ database,
    admissionForTransaction: createMysqlCoreDeploymentAdmission,
    term: { requireNewBusiness: async tx => { record(tx, "term"); f.termCalls++; if (f.termDenied) throw new Error("subscription expired"); } },
    configuration: { loadWorkspaceSnapshot: async (tenant, workspace, tx) => {
      assert.equal(tenant, tenantId); assert.equal(workspace, workspaceId); assert.ok(tx.id); record(tx, "configuration");
      // 使用真实配置 reader，包含 lockActiveCategoryBinding 的原父 fence 和空间/已发布版本锁。
      const snapshot = await configuration.loadWorkspaceSnapshot(tenant, workspace, tx);
      await f.insideConfiguration?.(tx);
      return snapshot;
    } },
    deploymentForTransaction: tx => ({ requireAvailable: async (core, tenant) => {
      assert.equal(core, "rental"); assert.equal(tenant, tenantId); record(tx, "deployment");
      if (!f.deployed) { const error = new Error("deployment unavailable"); error.code = "core_unavailable"; throw error; }
    } })
  });
  const contacts = { getRequestWorkspaceId, resolveWorkspaceId: async (_tx, tenant) => {
    assert.equal(getRequestIdentity()?.tenantId, tenant); assert.equal(getRequestWorkspaceId(), workspaceId); return workspaceId;
  } };
  const facts = new RentalCoreFactRepository(database, contacts);
  facts.findOrder = async (_tenant, id) => copy(f.orders.get(id));
  facts.listOrders = async () => [...f.orders.values()].map(copy);
  const notificationFacts = new RentalBusinessFactRepository(database, contacts);
  const templates = ["order.pickup_overdue", "order.no_show"].map((eventCode, i) => ({ id: `template-${i}`, version: 1,
    tenantId, name: eventCode, eventCode, channel: "sms", status: "enabled", title: "notice", body: "body", providerTemplateCode: "SMS_OFFLINE",
    variableSchema: {}, retry: { maxAttempts: 3 } }));
  const state = { notificationTemplates: templates, notificationLogs: [] };
  const context = { profile: { tenantId, categoryCode: "camping" }, category: { code: "camping" },
    settings: { notifications: { enabledEvents: templates.map(t => t.eventCode) } }, groups: [], couponTemplates: [], locations: [], operators: [] };
  const notificationRuntime = { hasEnabledProvider: async () => true, sendNotificationSms: async (...args) => {
    f.sends++; assert.equal(args[0], tenantId); assert.match(args.at(-1), /^notification:/u); await f.onSend?.();
    if (f.sendUnknown) throw new NotificationDeliveryUnknownError("provider result unknown");
    return { configured: true, provider: "aliyun_sms", externalRequestId: "original-provider-receipt" };
  } };
  const secretBox = { fingerprint: value => `fingerprint:${value}`, encrypt: value => JSON.stringify(value), decrypt: JSON.parse };
  const business = new RentalBusinessService({}, notificationFacts, {}, undefined, database, undefined, undefined, undefined, undefined, undefined, notificationRuntime, secretBox);
  // 仅替换与本片无关的配置/缓存装载；发送、认领、begin、结果 CAS 全部使用实际实现。
  business.state = () => state; business.workspaceOf = () => workspaceId;
  business.refreshWorkspaceContext = async (_tenant, value) => value;
  business.refreshFromDatabase = async reason => { f.refreshReasons.push(reason); };
  business.refreshCouponTemplateCache = async (tenant, supplier) => {
    assert.equal(tenant, tenantId); assert.equal(typeof supplier, "function"); f.couponContextSuppliers.push(supplier);
  };
  business.persist = async () => {};
  business.releaseCouponInTransaction = async (_tenant, order, tx) => record(tx, "release-coupon", order);
  business.runDuePriceAdjustments = async () => { f.commands.push("price-adjustment"); };
  const command = (status, name) => async (_tenant, id, tx) => {
    assert.ok(tx?.id); const order = f.orders.get(id); assert.ok(order); order.status = status;
    if (name === "expire") order.cancellationReason = "订单超时未支付";
    f.commands.push(name); record(tx, "command", name); return copy(order);
  };
  const core = { readBusinessContext: async () => { f.contextReads++; return context; }, persist: async () => {},
    listExpiredPendingOrderIds: async () => f.expired ?? [], listPickupOverdueOrderIds: async () => f.overdue ?? [],
    listNoShowCandidateIds: async () => f.noShow ?? [], getOrder: async (_tenant, id) => copy(f.orders.get(id)),
    expirePendingOrder: command("cancelled", "expire"), markPickupOverdueOrder: command("pickup_overdue", "overdue"),
    confirmNoShowOrder: async (tenant, id, _reason, tx) => command("no_show", "no-show")(tenant, id, tx),
    recordNoShowNotice: async (_tenant, id, at, tx) => { f.orders.get(id).noShowNoticeAt = at; record(tx, "command", "notice"); return copy(f.orders.get(id)); } };
  const idempotent = new RentalIdempotentActionService(database, {
    find: async (tenant, action, key) => copy(f.receipts.get(`${tenant}:${action}:${key}`)),
    record: async (row, tx) => { assert.ok(tx.id); f.receipts.set(`${row.tenantId}:${row.action}:${row.key}`, copy(row)); record(tx, "receipt", row.action); }
  });
  const payments = new PaymentRuntimeService(database, { runtimeConfig: async () => ({ provider: "alipay" }) }, {
    recordEvent: async (_tenant, _workspace, orderId, event, _operator, tx) => {
      assert.ok(tx?.id); assert.equal(event.idempotencyKey, `payment:${[...f.intents.values()].find(row => row.orderId === orderId).id}`);
      f.funding++; record(tx, "funding", orderId);
    }
  }, {});
  payments.queryAlipayIntent = async () => { f.queries++; await f.onQuery?.(); if (f.queryUnknown) throw new Error("query unknown");
    return f.paymentPaid ? { paid: true, closed: false, amount: 100, externalTransactionId: "paid-original", state: "TRADE_SUCCESS" }
      : { paid: false, closed: false, state: "WAIT_BUYER_PAY" }; };
  payments.closeAlipayIntent = async () => { f.closes++; await f.onClose?.(); };
  const participants = createRentalApplicationParticipants({ database, facts, core, business, idempotent,
    serviceCapacities: { releaseForOrder: async (_t, id, _r, _at, tx) => record(tx, "release-capacity", id) },
    corporateSettlement: { settleCancelledOrderCredit: async (_t, id, _r, tx) => record(tx, "release-credit", id) }, payments, authority: f.authority });
  f.participants = participants; f.business = business; f.notificationFacts = notificationFacts;
  f.run = job => participants.dueJobs.runLocked(participants.dueJobs.jobs.find(row => row.name === job), tenantId, workspaceId);
  f.order = (id = "order-original") => { const row = { id, tenantId, workspaceId, status: "reserved", orderNo: "original-no", customerName: "离线客户",
    contactPhone: "13800000000", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600_000).toISOString(), allocations: [] };
    f.orders.set(id, row); return row; };
  f.notification = (id = "notification-original", status = "queued") => {
    const row = { id, tenantId, workspaceId, templateId: "template-0", templateVersion: 1, eventCode: "order.pickup_overdue", channel: "sms",
      recipient: "138****0000", recipientEncrypted: JSON.stringify({ recipient: "13800000000" }), renderedTitle: "notice", renderedBody: "body",
      variables: {}, status, provider: "sms_pending", attempts: 0, maxAttempts: 3, revision: 1, leaseUntil: null,
      nextAttemptAt: new Date(Date.now() - 1000), createdAt: new Date(), businessObjectType: "order", businessObjectId: "order-original" };
    f.notifications.set(id, row); return row;
  };
  f.intent = (id = "intent-original") => { const row = { id, tenantId, workspaceId, orderId: "order-original", provider: "alipay", method: "alipay",
    merchantOrderNo: "original-merchant-no", instrument: "rental", currency: "CNY", amount: 100, status: "pending", expiresAt: new Date(Date.now() - 1000) };
    f.intents.set(id, row); return row; };
  return f;
}

function assertOrderBeforeWorkspace(f) {
  for (const tx of new Set(f.trace.map(row => row.tx))) {
    const sequence = f.trace.filter(row => row.tx === tx).map(row => row.kind);
    if (sequence.includes("Order") && sequence.includes("Workspace")) {
      assert.ok(sequence.indexOf("Tenant") < sequence.indexOf("Order"));
      assert.ok(sequence.indexOf("Order") < sequence.indexOf("Workspace"), `${tx}: ${sequence.join("→")}`);
    }
  }
}

function priceFixture() {
  const f = fixture(); f.grant = "enabled";
  const rate = { id: "rate", itemGroupId: "group", itemGroupCode: "original-group", itemGroupName: "original group",
    unit: category.businessModel.pricingUnits[0], baseAmount: 100, weekendMultiplier: 1, holidayMultiplier: 1,
    depositAmount: 0, minimumUnits: 1 };
  const plan = { id: "plan", tenantId, workspaceId, categoryCode: "camping", code: "original-price", name: "original",
    currency: "CNY", status: "enabled", version: "1.0", effectiveFrom: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", rates: [rate] };
  f.price = { adjustment: { id: "adjustment", tenantId, workspaceId, planId: "plan", status: "pending",
    scheduledAt: new Date("2026-01-02T00:00:00Z"), finalRates: [{ ...rate, baseAmount: 120 }], baseVersionId: null,
    changes: [], changeReason: "original scheduled price", createdBy: "original-operator" }, plan: copy(plan), versions: [] };
  f.business.state().pricingPlans = [copy(plan)];
  f.business.configStore = new RentalBusinessConfigRepository(f.database, {
    resolveWorkspaceId: resolveScopeWorkspaceId, assertScopedWrite, lockCategoryBinding: lockActiveCategoryBinding
  });
  f.business.runDuePriceAdjustments = RentalBusinessService.prototype.runDuePriceAdjustments.bind(f.business);
  const tables = tx => ({
    rentalPriceAdjustmentPlan: {
      findMany: async ({ where }) => { await f.afterDueRead?.(); return matches(f.price.adjustment, where) ? [copy(f.price.adjustment)] : []; },
      findFirst: async ({ where }) => matches(f.price.adjustment, where) ? copy(f.price.adjustment) : null,
      updateMany: async ({ where, data }) => {
        if (!matches(f.price.adjustment, where)) return { count: 0 };
        f.trace.push({ tx: tx.id, kind: "adjustment-write", value: data.status }); change(f.price.adjustment, data); return { count: 1 };
      }
    },
    rentalPricingPlan: {
      findMany: async ({ where }) => matches(f.price.plan, where) ? [copy(f.price.plan)] : [],
      findUnique: async ({ where }) => matches(f.price.plan, where) ? copy(f.price.plan) : null,
      upsert: async ({ where, update }) => {
        assert.equal(where.id, f.price.plan.id); f.trace.push({ tx: tx.id, kind: "plan-write" }); change(f.price.plan, update); return copy(f.price.plan);
      }
    },
    rentalPriceVersion: {
      findFirst: async ({ where }) => copy(f.price.versions.find(row => matches(row, where)) ?? null),
      aggregate: async () => ({ _max: { sequence: f.price.versions.length || null } }),
      create: async ({ data }) => { const row = { id: `price-version-${f.price.versions.length + 1}`, ...copy(data) };
        f.price.versions.push(row); f.trace.push({ tx: tx.id, kind: "version-write" }); return copy(row); }
    }
  });
  Object.assign(f.database, tables());
  f.beforeQuery = tx => { Object.assign(tx, tables(tx)); };
  const original = f.database.$transaction.bind(f.database);
  f.database.$transaction = async (consume, options) => {
    // Only transport rows roll back; the original runtime and both transactions
    // remain unchanged. The named-lock owner is not an outer business transaction.
    const snapshot = options?.timeout ? undefined : copy(f.price);
    try {
      const value = await original(async tx => {
        // Prisma 的模型委托在事务创建时即存在，读取收据不必先发原始 SQL。
        Object.assign(tx, tables(tx));
        return consume(tx);
      }, options);
      if (snapshot && f.price.versions.length > snapshot.versions.length) await f.afterPriceCommit?.();
      return value;
    } catch (error) {
      if (snapshot) { f.price = snapshot; await f.afterPriceRollback?.(); }
      throw error;
    }
  };
  return f;
}

let completed = false, groups = 0;
process.once("beforeExit", () => assert.ok(completed, "worker 测试不能留下未完成的等待"));
async function check(name, run) { await run(); groups++; console.log(`PASS ${name}`); }
async function main() {
  await check("调价实际 runtime/config 原提交与失败写事务均持 admission，提交后停新不改原结果", async () => {
    for (const state of ["stopped", "unknown"]) {
      const f = priceFixture(); f.afterDueRead = () => { f.admission = state; };
      await assert.rejects(() => f.run("run_due_price_adjustments"), denied);
      assert.equal(f.price.adjustment.status, "pending"); assert.equal(f.price.versions.length, 0);
      assert.ok(!f.trace.some(row => row.kind.endsWith("-write")));
    }
    const failed = priceFixture(); failed.price.adjustment.baseVersionId = "missing-original-version";
    failed.afterPriceRollback = () => { failed.admission = "stopped"; };
    await assert.rejects(() => failed.run("run_due_price_adjustments"), denied);
    assert.equal(failed.price.adjustment.status, "pending"); assert.equal(failed.price.versions.length, 0);
    assert.ok(!failed.trace.some(row => row.kind === "adjustment-write"), "the original failure write also rechecks admission");
    const accepted = priceFixture(); accepted.afterPriceCommit = () => { accepted.admission = "stopped"; };
    assert.equal(await accepted.run("run_due_price_adjustments"), true);
    assert.equal(accepted.price.adjustment.status, "applied"); assert.equal(accepted.price.versions.length, 1);
    assert.equal(accepted.price.plan.rates[0].baseAmount, 120);
    const txs = new Set(accepted.trace.filter(row => row.kind.endsWith("-write")).map(row => row.tx));
    assert.equal(txs.size, 1);
    for (const tx of txs) {
      const rows = accepted.trace.filter(row => row.tx === tx).map(row => row.kind);
      assert.ok(rows.indexOf("Tenant") < rows.indexOf("admission"));
      assert.ok(rows.indexOf("admission") < rows.indexOf("Workspace"));
      assert.ok(!rows.includes("Order"), "price versions do not pre-lock an unrelated order");
    }
  });
  await check("部署停新实际 reader 在调价原事务复核，五项原收尾不追加 accepting", async () => {
    const f = fixture(); f.grant = "enabled";
    await f.database.$transaction(async tx => {
      await f.authority.assertCurrent(request("run_due_price_adjustments"), tx);
      assert.ok(f.trace.some(row => row.tx === tx.id && row.kind === "admission"));
      assert.ok(f.trace.every(row => row.tx === tx.id));
    });
    for (const state of ["stopped", "unknown"]) {
      f.admission = state;
      await assert.rejects(() => f.run("run_due_price_adjustments"), denied);
      assert.deepEqual(f.commands, []);
      f.trace.length = 0;
      for (const definition of RENTAL_APPLICATION_JOB_DESCRIPTORS.filter(job => job.id !== "run_due_price_adjustments")) {
        await f.authority.assertCurrent(request(definition.id));
      }
      assert.ok(!f.trace.some(row => row.kind === "admission"), "original closeout does not require accepting");
    }
    const missing = { database: f.database, term: { requireNewBusiness: async () => {} },
      configuration: { loadWorkspaceSnapshot: async () => { throw Error("not called"); } },
      deploymentForTransaction() { throw Error("not called"); } };
    assert.throws(() => createRentalWorkerAuthority(missing), error => error.code === "core_unavailable");
  });
  await check("disabled 只接受原五项；未知用途/版本/空间和调价失败关闭", async () => {
    const f = fixture();
    for (const definition of RENTAL_APPLICATION_JOB_DESCRIPTORS) {
      const operation = () => f.authority.assertCurrent(request(definition.id));
      if (definition.id === "run_due_price_adjustments") await assert.rejects(operation, denied); else await operation();
    }
    for (const changes of [{ jobId: "unknown" }, { purpose: "new_business" }, { coreId: "other" }, { implementationVersion: "99.0.0" }]) {
      await assert.rejects(() => f.authority.assertCurrent({ ...request("expire_pending_orders"), ...changes }), denied);
    }
    assert.equal(f.termCalls, 0); f.grant = "enabled"; await f.run("run_due_price_adjustments");
    // 原两段准入的配置 reader 现在各自复入同事务父 fence；没有增加外围事务。
    assert.equal(f.termCalls, 4);
    assert.equal(new Set(f.trace.filter(row => row.kind === "term").map(row => row.tx)).size, 2);
    assert.deepEqual(f.commands, ["price-adjustment"]);
    f.termDenied = true; await assert.rejects(() => f.run("run_due_price_adjustments"), /subscription expired/u);
  });
  await check("缺当前 tenant/grant/gate/binding/deployment/配置仍拒绝", async () => {
    for (const mutate of [f => { f.tenantStatus = "FROZEN"; }, f => { f.workspaceStatus = "DISABLED"; },
      f => { f.gate = false; }, f => { f.grant = null; }, f => { f.grant = "unknown"; }, f => { f.binding = null; },
      f => { f.binding.containerId = "other"; }, f => { f.binding.dataVersion = "9.0.0"; }, f => { f.configured = false; }, f => { f.deployed = false; }]) {
      const f = fixture(); mutate(f); await assert.rejects(() => f.run("retry_due_notifications"), denied);
      assert.equal(f.sends, 0); assert.equal(f.held.size, 0);
    }
  });
  await check("事务逐单证明范围与 Tenant→Order→Workspace；parent 不锁 Workspace", async () => {
    const f = fixture(); f.order();
    await f.database.$transaction(tx => f.authority.assertParentCurrent(request("expire_payment_intents"), tx));
    assert.equal(f.trace.some(row => row.kind === "Workspace"), false);
    await assert.rejects(() => f.database.$transaction(tx => f.authority.assertCurrent(request("expire_payment_intents"), tx)), denied);
    await f.database.$transaction(tx => f.authority.assertCurrent(request("expire_payment_intents", "order-original"), tx));
    f.orders.get("order-original").workspaceId = "other";
    await assert.rejects(() => f.database.$transaction(tx => f.authority.assertCurrent(request("expire_payment_intents", "order-original"), tx)), denied);
    assertOrderBeforeWorkspace(f);
  });
  await check("配置父 fence 重入只认原事务和对象，退出后的异步链不能沿用许可", async () => {
    const f = fixture(); f.order();
    f.insideConfiguration = tx => f.authority.assertCurrent(request("expire_payment_intents", "other-order"), tx);
    await assert.rejects(() => f.authority.assertCurrent(request("expire_payment_intents", "order-original")), denied);
    let late; const resume = defer();
    f.insideConfiguration = tx => { late = resume.promise.then(() => f.authority.assertCurrent(request("expire_payment_intents", "order-original"), tx)); };
    await f.authority.assertCurrent(request("expire_payment_intents", "order-original"));
    const rejection = assert.rejects(() => late, denied); resume.resolve(); await rejection;
  });
  await check("标准调度不接受同名伪执行器；等待准入期间修改也不替换原函数", async () => {
    const f = fixture(), jobs = f.participants.dueJobs.jobs; let forged = 0;
    await assert.rejects(() => f.participants.dueJobs.runLocked({ name: jobs[0].name, run: async () => { forged++; } }, tenantId, workspaceId), /原登记执行器/u);
    const held = defer(), resume = defer(); let once = false;
    f.beforeQuery = async (_tx, sql) => { if (!once && sql.includes("FROM Tenant")) { once = true; held.resolve(); await resume.promise; } };
    const running = f.run("expire_pending_orders"); await held.promise;
    jobs[0].run = async () => { forged++; }; resume.resolve(); await running;
    assert.equal(forged, 0); assert.equal(f.held.size, 0);
  });
  await check("原配货扫描与待付款到期在 disabled 下消费原订单，回放不重写", async () => {
    const f = fixture(); f.order(); await f.participants.allocation.runDue(); assertOrderBeforeWorkspace(f);
    f.expired = ["order-original"]; await f.run("expire_pending_orders");
    // 使用原常量，避免测试夹具文字成为回放依据。
    f.orders.get("order-original").cancellationReason = require("../packages/rental-core/src/mysql-core-runtime").RENTAL_PENDING_PAYMENT_TIMEOUT_REASON;
    await f.run("expire_pending_orders"); assert.deepEqual(f.commands, ["expire"]); assert.equal(f.receipts.size, 1);
    assert.deepEqual(f.refreshReasons, ["committed_order", "committed_order"]);
    assert.equal(f.couponContextSuppliers.length, 2); assert.equal(f.contextReads, 0, "提交后券缓存接点不得提前求值当前上下文");
    assertOrderBeforeWorkspace(f);
    f.orders.get("order-original").workspaceId = "other"; f.receipts.clear();
    await assert.rejects(() => f.run("expire_pending_orders"), denied); assert.deepEqual(f.commands, ["expire"]);
  });
  await check("原领取逾期附属通知同订单事务复核，实际发送和 no-show 记录各一次", async () => {
    const f = fixture(); f.order(); f.overdue = ["order-original"];
    await f.run("reconcile_pickup_overdue"); assert.equal(f.sends, 1); assert.ok(f.orders.get("order-original").noShowNoticeAt);
    await f.run("reconcile_pickup_overdue"); assert.equal(f.sends, 1); assert.deepEqual(f.commands, ["overdue"]);
    assertOrderBeforeWorkspace(f);
  });
  await check("原通知队列只派发已保存可重试记录，unknown 与租约过期不重新发送", async () => {
    const f = fixture(); f.notification(); f.notification("unknown-original", "delivery_uncertain");
    await f.run("retry_due_notifications"); assert.equal(f.sends, 1);
    assert.equal(f.notifications.get("notification-original").status, "sent");
    await f.run("retry_due_notifications"); assert.equal(f.sends, 1);
    assert.equal(f.notifications.get("unknown-original").status, "delivery_uncertain");
  });
  await check("认领后撤销门禁阻断新运输，begin 应答未知不运输不重发", async () => {
    const f = fixture(); f.notification(); f.afterClaim = () => { f.gate = false; };
    await assert.rejects(() => f.run("retry_due_notifications"), denied); assert.equal(f.sends, 0);
    const u = fixture(); u.notification(); u.loseBeginResponse = true;
    await assert.rejects(() => u.run("retry_due_notifications"), /begin commit response unknown/u);
    assert.equal(u.sends, 0); assert.equal(u.notifications.get("notification-original").status, "delivery_uncertain");
    u.loseBeginResponse = false; await u.run("retry_due_notifications"); assert.equal(u.sends, 0);
  });
  await check("供应商后撤权仍记录原结果；双结果写失败仍为不可重发 unknown", async () => {
    const f = fixture(); f.notification(); f.onSend = () => { f.gate = false; };
    await f.run("retry_due_notifications"); assert.equal(f.notifications.get("notification-original").status, "sent");
    const u = fixture(); u.notification(); u.failResults = true;
    await u.run("retry_due_notifications"); assert.equal(u.notifications.get("notification-original").status, "delivery_uncertain");
    u.failResults = false; await u.run("retry_due_notifications"); assert.equal(u.sends, 1);
  });
  await check("原过期支付每次query/close复核原订单，运输后结果不被撤权抹除", async () => {
    const f = fixture(); f.order(); f.intent(); f.onClose = () => { f.gate = false; };
    await f.run("expire_payment_intents"); assert.equal(f.queries, 1); assert.equal(f.closes, 1);
    assert.equal(f.intents.get("intent-original").status, "closed"); assertOrderBeforeWorkspace(f);
    const revoked = fixture(); revoked.order(); revoked.intent(); revoked.onQuery = () => { revoked.gate = false; };
    await revoked.run("expire_payment_intents"); assert.equal(revoked.queries, 1); assert.equal(revoked.closes, 0);
    assert.equal(revoked.intents.get("intent-original").status, "pending");
    const unknown = fixture(); unknown.order(); unknown.intent(); unknown.queryUnknown = true;
    await unknown.run("expire_payment_intents"); assert.equal(unknown.closes, 0); assert.equal(unknown.intents.get("intent-original").status, "pending");
  });
  await check("查询到原已付结果沿原入账事务一次落账，跨空间订单不能运输", async () => {
    const f = fixture(); f.order(); f.intent(); f.paymentPaid = true;
    await f.run("expire_payment_intents"); assert.equal(f.funding, 1); assert.equal(f.intents.get("intent-original").status, "paid");
    await f.run("expire_payment_intents"); assert.equal(f.funding, 1); assert.equal(f.queries, 1); assertOrderBeforeWorkspace(f);
    const other = fixture(); other.order().workspaceId = "other"; other.intent();
    await other.run("expire_payment_intents"); assert.equal(other.queries, 0); assert.equal(other.closes, 0); assert.equal(other.funding, 0);
  });
  await check("退出等已进入运输的原结果完成，随后不启动新批次", async () => {
    const f = fixture(); f.notification(); const sent = defer(), finish = defer(); let destroyed = false;
    f.onSend = async () => { sent.resolve(); await finish.promise; };
    const running = f.run("retry_due_notifications"); await sent.promise;
    assert.equal(await f.run("retry_due_notifications"), false, "原命名锁期间并发批次不能重复运输");
    const stopping = f.participants.dueJobs.onModuleDestroy().then(() => { destroyed = true; });
    assert.equal(destroyed, false); finish.resolve(); await running; await stopping;
    assert.equal(f.notifications.get("notification-original").status, "sent");
    assert.equal(await f.run("retry_due_notifications"), false); assert.equal(f.sends, 1); assert.equal(f.held.size, 0);
  });
  await check("订单锁等待期间退出，准入返回后不开始订单命令或登记收据", async () => {
    const f = fixture(); f.order(); f.expired = ["order-original"];
    const waiting = defer(), release = defer(); let once = false, destroyed = false;
    f.beforeQuery = async (_tx, sql) => {
      if (!once && sql.includes("FROM rental_orders")) { once = true; waiting.resolve(); await release.promise; }
    };
    const running = f.run("expire_pending_orders"); await waiting.promise;
    const rejected = assert.rejects(() => running, /准入等待期间已停止/u);
    const stopping = f.participants.dueJobs.onModuleDestroy().then(() => { destroyed = true; });
    assert.equal(destroyed, false); release.resolve(); await rejected; await stopping;
    assert.deepEqual(f.commands, []); assert.equal(f.receipts.size, 0); assert.equal(f.held.size, 0);
    assert.equal(await f.run("expire_pending_orders"), false); assertOrderBeforeWorkspace(f);
  });
  completed = true; console.log(`rental worker recovery: ${groups} groups passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
