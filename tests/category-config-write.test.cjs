"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalCoreConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-core-config.repository.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const calls = [];
const client = {
  $transaction: async (write, options) => { assert.equal(options?.isolationLevel, "ReadCommitted", "自建配置事务必须避免锁前旧快照"); calls.push("transaction"); return write(client); },
  businessWorkspace: { findFirst: async () => ({ id: "ws" }) },
  $queryRaw: async () => { calls.push("lock"); return [{ categoryCode: "CAMERA", categoryVersionId: "v2", categoryAdoptionRevision: 2, status: "ACTIVE" }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("version"); return { categoryCode: "CAMERA", structureVersion: 1, status: "published", definition }; } }
};
for (const name of ["rentalTenantBusinessSettings", "rentalFulfillmentLocation", "rentalFulfillmentOperator", "rentalInspectionTemplate"]) client[name] = {
  findUnique: async () => null, upsert: async () => { calls.push(name); return {}; }
};
const repo = new RentalCoreConfigRepository(client);
const scope = (fn) => runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, fn);
const binding = { categoryVersionId: "v2", adoptionRevision: 2 };
const stale = { categoryVersionId: "v1", adoptionRevision: 1 };
const settings = { tenantId: "t", categoryCode: "camera", pricing: { enabledUnits: ["hour"], defaultUnit: "hour" }, fulfillment: { enabledModes: ["store_pickup_return"] }, calendar: { holidayPricingEnabled: false } };
async function approvedNotificationsSmoke() {
  const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
  const { ApiAuthGuard } = require("../apps/api/dist/common/api-auth.guard.js");
  const { ApprovedSettingsRouteAuthority } = require("../apps/api/dist/modules/rental-core/approved-settings-route.authority.js");
  const { ApprovedSettingsChangeService } = require("../apps/api/dist/modules/rental-core/approved-settings-change.service.js");
  const { createAbsorbingConfigStore, createAbsorbingFactStore } = require("./helpers/absorbing-config-store.cjs");
  const category = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === "camera"));
  const workspace = { id: "ws", tenantId: "t", categoryCode: "CAMERA", categoryVersionId: "v2", categoryAdoptionRevision: 2, status: "ACTIVE" };
  let rows = { changes: [], operations: [], consumptions: [], settings: null }, ackLost = false, approved = false, failConsume = false, failReplay = false, casMiss = false;
  let time = new Date("2026-10-08T00:00:00.000Z");
  const user = { id: "admin", tenantId: "t", isActive: true, isSaasAdmin: false, isPlatformAdmin: false, dataScope: "all", permissions: ["rental-os:rules:manage"] };
  const local = (data, transactional) => {
    const ledger = key => ({
      findUnique: async ({ where }) => {
        const filter = Object.keys(where)[0].includes("_") ? Object.values(where)[0] : where;
        return structuredClone(data[key].find(row => Object.entries(filter).every(([name, value]) => row[name] === value)) ?? null);
      },
      create: async ({ data: value }) => {
        assert.equal(transactional, true);
        const saved = structuredClone({ createdAt: time, ...value }); data[key].push(saved); return structuredClone(saved);
      }
    });
    return {
      records: data,
      businessWorkspace: { findFirst: async () => structuredClone(workspace) },
      $queryRaw: async query => { assert.match(query.sql, /FOR UPDATE/); assert.equal(transactional, true); return [structuredClone(workspace)]; },
      rentalCategoryVersion: { findUnique: async () => ({ categoryCode: "CAMERA", structureVersion: 1, status: "published", definition: category }) },
      rentalApprovedSettingsChange: ledger("changes"), rentalApprovedSettingsOperation: ledger("operations"),
      rentalTenantBusinessSettings: {
        findUnique: async () => structuredClone(data.settings),
        upsert: async ({ create, update }) => {
          assert.equal(transactional, true);
          if (!data.settings) { assert.equal(create.settingsRevision, 1); data.settings = structuredClone(create); }
          else { assert.deepEqual(update.settingsRevision, { increment: 1 }); data.settings = { ...data.settings, ...structuredClone(update), settingsRevision: data.settings.settingsRevision + 1 }; }
          return { settingsRevision: data.settings.settingsRevision };
        },
        updateMany: async ({ where, data: update }) => {
          assert.equal(transactional, true); assert.deepEqual(update.settingsRevision, { increment: 1 });
          if (casMiss || where.settingsRevision !== data.settings.settingsRevision) return { count: 0 };
          assert.equal(where.workspaceId, "ws"); assert.equal(where.tenantId, "t");
          data.settings = { ...data.settings, ...structuredClone(update), settingsRevision: data.settings.settingsRevision + 1 };
          return { count: 1 };
        }
      }
    };
  };
  const db = new Proxy({}, { get: (_target, key) => key === "$transaction" ? async (work, options) => {
    assert.equal(options.isolationLevel, "ReadCommitted");
    const draft = structuredClone(rows), result = await work(local(draft, true));
    const committedOperation = draft.operations.length > rows.operations.length;
    rows = draft;
    if (ackLost && committedOperation) throw Error("synthetic lost commit acknowledgement");
    return result;
  } : local(rows, false)[key] });
  const repository = new RentalCoreConfigRepository(db);
  const store = { ...createAbsorbingConfigStore([{ id: "ws", tenantId: "t", categoryCode: "camera", isDefault: true }]),
    readVersionedBusinessSettings: repository.readVersionedBusinessSettings.bind(repository), upsertBusinessSettings: repository.upsertBusinessSettings.bind(repository) };
  const core = new RentalCoreService(store, createAbsorbingFactStore());
  await core.onApplicationBootstrap();
  await scope(() => core.saveBusinessSettings("t", core.getBusinessSettings("t"), "admin"));
  assert.equal(rows.settings.settingsRevision, 1);
  const initial = structuredClone(rows.settings.settings);
  const guard = new ApiAuthGuard({ resolveAccessContext: async (token, options) => {
    assert.equal(token, "Bearer settings-test"); assert.equal(options.audience, "operator");
    return { user: structuredClone(user), workspaceId: "ws", workspaceValid: true };
  } });
  const authority = new ApprovedSettingsRouteAuthority(guard, { current: async () => ({ authorization: "Bearer settings-test", audience: "operator", requestId: "settings-request" }) });
  const participant = {
    authorize: async (binding, tx) => { assert.equal(binding.actorId, "admin"); assert.ok(tx.records); if (!approved) throw new (require("@nestjs/common").ForbiddenException)(); },
    consume: async (binding, receipt, tx) => {
      assert.equal(tx.records.settings.settingsRevision, receipt.resultRevision);
      assert.equal(tx.records.operations[0].id, receipt.receiptId);
      tx.records.consumptions.push({ binding, receipt });
      if (failConsume) throw Error("synthetic participant failure");
    },
    replay: async (_binding, receipt) => {
      if (failReplay) throw new (require("@nestjs/common").ServiceUnavailableException)();
      assert.ok(rows.consumptions.some(row => row.receipt.receiptId === receipt.receiptId));
    }
  };
  const app = new ApprovedSettingsChangeService(db, core, authority, participant, () => time);
  const next = { enabledEvents: ["order.created"], editableChannels: ["email"] };
  const preparation = { changeKey: "notification-a", baseRevision: 1, notifications: next, expiresAt: "2026-10-09T00:00:00.000Z" };
  await assert.rejects(async () => app.prepareChange({ ...preparation, payment: {} }), /参数无效/);
  await assert.rejects(() => app.prepareChange({ ...preparation, notifications: { ...next, enabledEvents: ["unknown.event"] } }), /已注册/);
  const change = await app.prepareChange(preparation);
  assert.deepEqual(await app.prepareChange(preparation), change);
  assert.deepEqual(await app.readAuthorizedChange({ changeId: change.changeId, changeHash: change.changeHash }), change);
  const command = { changeId: change.changeId, changeHash: change.changeHash, operationKey: "settings-operation-a",
    approval: { proposalId: "settings-proposal", proposalRevision: 1, approvalId: "settings-approval", reviewedPayloadHash: "a".repeat(64) } };
  await assert.rejects(() => app.commitApprovedChange(command), error => error.getStatus?.() === 403);
  approved = true; failConsume = true;
  await assert.rejects(() => app.commitApprovedChange(command), error => error.code === "SETTINGS_RESULT_UNKNOWN");
  assert.equal(rows.settings.settingsRevision, 1); assert.equal(rows.operations.length, 0); assert.equal(rows.consumptions.length, 0);
  assert.deepEqual(await app.readOperation({ operationKey: command.operationKey }), { state: "not_observed", nextAction: "read_operation" });
  failConsume = false; casMiss = true;
  await assert.rejects(() => app.commitApprovedChange(command), /版本已变化/);
  casMiss = false; workspace.categoryAdoptionRevision = 3;
  await assert.rejects(() => app.commitApprovedChange(command), /品类绑定已变化/);
  workspace.categoryAdoptionRevision = 2; ackLost = true;
  await assert.rejects(() => app.commitApprovedChange(command), error => error.code === "SETTINGS_RESULT_UNKNOWN");
  assert.equal(rows.settings.settingsRevision, 2); assert.equal(rows.operations.length, 1); assert.equal(rows.consumptions.length, 1);
  assert.deepEqual(scope(() => core.getBusinessSettings("t").notifications), initial.notifications, "unknown 不提前发布缓存");
  failReplay = true;
  await assert.rejects(() => app.readOperation({ operationKey: command.operationKey }), error => error.code === "SETTINGS_RESULT_UNKNOWN" && error.nextAction === "read_operation");
  await assert.rejects(() => app.commitApprovedChange(command), error => error.code === "SETTINGS_RESULT_UNKNOWN");
  assert.equal(rows.operations.length, 1);
  failReplay = false;
  const result = await app.readOperation({ operationKey: command.operationKey });
  assert.equal(result.state, "committed"); assert.equal(result.cacheRefreshed, true);
  assert.deepEqual(scope(() => core.getBusinessSettings("t").notifications), next);
  const { notifications: oldNotifications, updatedAt: oldAt, updatedBy: oldBy, ...protectedBefore } = initial;
  const { notifications: newNotifications, updatedAt: newAt, updatedBy: newBy, ...protectedAfter } = rows.settings.settings;
  assert.deepEqual(protectedAfter, protectedBefore, "不能顺带改变支付、计价、会员等字段");
  time = new Date("2026-10-10T00:00:00.000Z"); ackLost = false;
  assert.deepEqual(await app.commitApprovedChange(command), result, "过期后保留原提交事实，不重新执行");
  await assert.rejects(() => app.commitApprovedChange({ ...command, approval: { ...command.approval, approvalId: "another" } }), /同一操作键/);
  const second = await app.prepareChange({ ...preparation, changeKey: "notification-b", baseRevision: 2,
    notifications: { enabledEvents: ["order.confirmed"], editableChannels: ["sms"] }, expiresAt: "2026-10-11T00:00:00.000Z" });
  await scope(() => core.saveBusinessSettings("t", core.getBusinessSettings("t"), "admin"));
  assert.equal(rows.settings.settingsRevision, 3);
  await assert.rejects(() => app.commitApprovedChange({ ...command, operationKey: "settings-operation-b", changeId: second.changeId, changeHash: second.changeHash }), /版本|品类绑定/);
  user.permissions = ["rental-os:order:view"];
  await assert.rejects(() => app.commitApprovedChange(command), error => error.getStatus?.() === 403);
  assert.equal((await app.readOperation({ operationKey: command.operationKey })).state, "committed");
  assert.equal(rows.operations.length, 1);
  const { AI_TOOL_CODES } = require('@rental-os/shared');
  const { AI_APPROVED_SETTINGS_DRAFT_VERSION: draftVersion, AI_APPROVED_SETTINGS_TOOL_CODE } = require('../packages/shared/src/ai-approved-settings-draft.ts');
  const { settingsContract } = require('../apps/api/dist/modules/ai-native/approval-execution/approved-settings-contracts.js');
  const { composeRequestBoundApprovedSettingsApplication } = require('../apps/api/dist/modules/ai-native/approval-execution/request-bound-approved-settings.application.js');
  const unavailable = async () => { throw Error('an unregistered settings tool must not request execution dependencies'); };
  const dependencies = { db, core, guard, auth: { resolveAccessContext: unavailable }, subscriptions: { readCategoryCommercialContext: unavailable },
    holderId: 'settings-worker', scene: { code: 'tenant.config.propose', version: '1' } };
  assert.throws(() => composeRequestBoundApprovedSettingsApplication(dependencies, { enabled: false, audience: 'operator' }));
  assert.throws(() => composeRequestBoundApprovedSettingsApplication({ ...dependencies, credentials: {} }, { enabled: true, audience: 'operator' }));
  const api = composeRequestBoundApprovedSettingsApplication(dependencies, { enabled: true, audience: 'operator' });
  const request = { headers: { authorization: 'Bearer settings-test' } };
  const preparing = { draftVersion, taskId: 'settings-task', runId: 'settings-run', stepId: 'settings-step', proposalId: 'settings-proposal',
    proposalRevision: 1, changeId: change.changeId, changeHash: change.changeHash };
  assert.equal((await api.prepare({ headers: {} }, preparing)).error.code, 'AI_ACCESS_DENIED');
  assert.equal((await api.prepare(request, { ...preparing, payment: {} })).error.code, 'AI_INVALID_INPUT');
  settingsContract('AiApprovedSettingsPreparationReceiptDraft', { draftVersion, state: 'not_observed', nextAction: 'read_preparation_receipt' }, true);
  settingsContract('AiApprovedSettingsOperationResultDraft', { draftVersion, ...result }, true);
  if (!AI_TOOL_CODES.includes(AI_APPROVED_SETTINGS_TOOL_CODE)) {
    assert.equal((await api.prepare(request, preparing)).error.code, 'AI_RESOURCE_UNAVAILABLE');
    const reference = { draftVersion, taskId: preparing.taskId, proposalId: preparing.proposalId, proposalRevision: 1, reviewedPayloadHash: 'a'.repeat(64) };
    assert.equal((await api.decide(request, { ...reference, decision: 'approve' })).error.code, 'AI_RESOURCE_UNAVAILABLE');
    assert.equal((await api.commitApprovedChange(request, { ...reference, operationKey: 'new-settings-operation', approvalId: 'new-approval' })).error.code, 'AI_RESOURCE_UNAVAILABLE');
    assert.equal(rows.operations.length, 1);
    console.log('approved-settings-application: strict transport/explicit opt-in and unregistered-tool fail-closed passed; no simulated registry or positive AI execution claim');
  }
  console.log("approved-settings: 真实 Core/仓储/Guard 的通知限定、版本/CAS、同事务 participant、unknown 回读与历史幂等通过；DB/Auth/批准 participant 为替身，不是 MySQL/AI 执行器验收");
}

(async () => {
  await scope(() => repo.upsertBusinessSettings(settings, "admin", undefined, binding));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "rentalTenantBusinessSettings"]);
  await assert.rejects(scope(() => repo.upsertBusinessSettings(settings, "admin", undefined, stale)), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"], "冲突不写入也不发布缓存");
  for (const invalid of [
    { ...settings, pricing: { enabledUnits: ["shift"], defaultUnit: "shift" } },
    { ...settings, fulfillment: { enabledModes: ["onsite_delivery"] } },
    { ...settings, categoryCode: "vehicle" }
  ]) await assert.rejects(scope(() => repo.upsertBusinessSettings(invalid, "admin")), /不支持|不一致/);
  definition.businessModel.supportsHolidayPricing = false;
  await assert.rejects(scope(() => repo.upsertBusinessSettings({ ...settings, calendar: { holidayPricingEnabled: true } }, "admin")), /节假日/);
  calls.length = 0;
  const location = { id: "l", tenantId: "t", type: "store", code: "L", name: "store", capabilities: ["pickup"], status: "enabled" };
  await scope(() => repo.upsertLocation(location, client, binding));
  assert.deepEqual(calls.splice(0), ["lock", "version", "rentalFulfillmentLocation"], "外层事务直接复用，不嵌套开事务");
  await assert.rejects(scope(() => repo.upsertLocation({ ...location, type: "project_site" })), /不支持/);
  await assert.rejects(scope(() => repo.upsertLocation(location, undefined, stale)), /版本已变化/);
  calls.length = 0;
  await scope(() => repo.upsertOperator({ id: "op", tenantId: "t", code: "OP", name: "operator", type: "self_operated", status: "enabled", createdAt: new Date().toISOString() }));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "rentalFulfillmentOperator"]);
  await scope(() => repo.upsertInspectionTemplate({ id: "inspection", tenantId: "t", categoryCode: "camera", code: "I", name: "inspection", stage: "pickup", version: "1", fields: [], enabled: true }));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "rentalInspectionTemplate"]);
  console.log("category-config-write: 设置/地点绑定复核、当前定义校验、主体/检查模板同锁与外层事务复用通过（仓储替身）");
  await approvedNotificationsSmoke();
})().catch((error) => { console.error(error); process.exitCode = 1; });
