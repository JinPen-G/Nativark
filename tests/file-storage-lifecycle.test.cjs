const assert = require("node:assert/strict");
const path = require("node:path");

process.env.NODE_ENV = "test";
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { FileStorageRuntimeService } = require(path.join(
  __dirname,
  "../apps/api/src/modules/integrations/file-storage.runtime.service"
));

const { FileBusinessAccessService } = require("../apps/api/src/modules/files/file-business-access.service");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { RentalBusinessFactRepository } = require("../apps/api/src/modules/rental-core/rental-business-fact.repository");
const { CustomerOperationsService } = require("../apps/api/src/modules/platform/customer-operations.service");
const { IntegrationsService } = require("../apps/api/src/modules/integrations/integrations.service");
const { IntegrationsRepository } = require("../apps/api/src/modules/integrations/integrations.repository");
const { runWithRequestIdentity, getRequestIdentity } = require("../apps/api/src/common/request-identity");
const { ApiAuthGuard } = require("../apps/api/src/common/api-auth.guard");
const { MembershipService } = require("../apps/api/src/modules/platform/membership.service");
const { SharedCustomerRepository } = require("../apps/api/src/modules/platform/shared-customer.repository");

const tenantId = "tenant-file-test";
const secondTenantId = "tenant-file-test-2";
const orderId = "order-file-test";
const assets = new Map();
const sessions = new Map();
const workspaceId = "workspace-file-test";
const otherWorkspaceId = "workspace-other";
let forceCompletionRace = false;
let fileConfig;
let beforeConfig;
let duringAudit;
const operatorIdentity = {
  tenantId, workspaceId, userId: "file-operator", isSaasAdmin: false, audience: "operator", dataScope: "all",
  permissions: ["system:integration:manage", "rental-os:order:view", "rental-core:asset:view",
    "rental-os:member:view", "rental-os:customer:reveal-sensitive", "rental-core:catalog:view", "rental-core:maintenance:view"],
  locationScope: { mode: "all", locationIds: [] }
};
const inScope = (changes, fn) => runWithRequestIdentity({ ...operatorIdentity, ...changes }, fn);
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (value instanceof Date) return row[key] instanceof Date && row[key].getTime() === value.getTime();
    if (key === "AND") return value.every(clause => matches(row, clause));
    if (key === "OR") return value.some(clause => matches(row, clause));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if ("in" in value) return value.in.includes(row[key]);
      if ("lte" in value) return row[key] != null && row[key] <= value.lte;
      if ("not" in value) return row[key] !== value.not;
      if ("some" in value) return (row[key] ?? []).some(item => matches(item, value.some));
      return matches(row[key] ?? {}, value);
    }
    return row[key] === value;
  });
}
const orders = [{ id: orderId, tenantId, workspaceId, createdBy: "file-operator", fulfillmentLocationId: "pickup-place",
  returnLocationId: "return-place", workOrders: [] },
  { id: "order-another-space", tenantId, workspaceId: otherWorkspaceId, createdBy: "file-operator", fulfillmentLocationId: "pickup-place", workOrders: [] },
  { id: "order-another-owner", tenantId, workspaceId, createdBy: "someone-else", fulfillmentLocationId: "other-place", workOrders: [] }];
const workOrders = [{ id: "work-file", tenantId, workspaceId, locationId: "pickup-place", createdBy: "someone-else", assigneeId: "file-operator", assetId: "inventory-file-test" }];
const inventory = [{ id: "inventory-file-test", tenantId, workspaceId, locationId: "pickup-place" },
  { id: "inventory-not-owned", tenantId, workspaceId, locationId: "pickup-place" }];
const customerProfiles = ["customer-file-test", "other-customer"].map(id => ({ id, tenantId,
  createdInWorkspaceId: workspaceId, createdByUserId: "file-operator" }));
const catalogGroup = { id: "group-image", tenantId, workspaceId, status: "enabled", attributes: { __itemGroupMedia: { images: [{ fileAssetId: "file-public-image" }] } } };
let publicationEnabled = true;
const lookup = rows => ({ findFirst: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
  findMany: async ({ where }) => rows.filter(row => matches(row, where)) });

function assetRow(id, status = "pending_upload", assetTenantId = tenantId, assetOrderId = orderId) {
  return {
    id,
    tenantId: assetTenantId,
    businessModule: "rental-core",
    businessType: "rental_order",
    businessId: assetOrderId,
    fileName: "contract.pdf",
    fileExt: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    storageProvider: "local_mock",
    storageKey: `tenant-files/${tenantId}/${id}/contract.pdf`,
    publicUrl: null,
    uploadScene: "order-contract",
    status,
    uploadedBy: null,
    metadata: { uploadMode: "simulation" },
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

const prisma = {
  rentalOrder: lookup(orders), rentalAsset: lookup(inventory), rentalWorkOrder: lookup(workOrders),
  rentalQuote: lookup([{ id: 'quote-file', tenantId, workspaceId, categoryCode: 'CAMERA', createdAt: new Date(), expiresAt: new Date(),
    request: { customerId: 'customer-file-test', fulfillmentLocationId: 'pickup-place', returnLocationId: 'return-place', services: [] },
    sourceSnapshot: { version: 'rental-quote-source-1', tenantId, workspaceId, actor: { kind: 'user', id: 'someone-else' }, audience: 'operator' } }]),
  customerMembershipReview: lookup([{ id: 'review-file', tenantId, customerId: 'customer-file-test' }]),
  customerCorporateContract: lookup([{ id: 'contract-file', tenantId, customerId: 'customer-file-test' }]),
  documentPrintJob: lookup([{ id: 'print-file', tenantId, businessType: 'rental_order', businessId: orderId },
    { id: 'print-cycle', tenantId, businessType: 'document_print_job', businessId: 'print-cycle' },
    { id: 'print-sensitive', tenantId, businessType: 'customer', businessId: 'customer-file-test' }]),
  asyncJob: lookup([{ id: 'job-file', tenantId, businessType: 'rental_order', businessId: 'order-another-space' }]),
  customerProfile: lookup(customerProfiles), rentalItemGroup: lookup([catalogGroup]),
  businessWorkspace: { findFirst: async ({ where }) => publicationEnabled && where.tenantId === tenantId && where.id === workspaceId
    ? { id: workspaceId, tenantId, status: "ACTIVE" } : null },
  fileAsset: {
    findMany: async ({ where, take }) => [...assets.values()].filter(row => matches(row, where)).slice(0, take ?? assets.size),
    create: async ({ data }) => {
      const row = { ...assetRow(data.id), ...data, createdAt: new Date(), updatedAt: new Date() };
      assets.set(row.id, row);
      return row;
    },
    findUniqueOrThrow: async ({ where }) => assets.get(where.id),
    findFirst: async ({ where }) => {
      const row = assets.get(where.id);
      return row && row.tenantId === where.tenantId && (!where.status || row.status === where.status) && (!where.businessType || row.businessType === where.businessType) && (!where.businessId || row.businessId === where.businessId) && (!where.uploadScene || row.uploadScene === where.uploadScene) ? row : null;
    },
    update: async ({ where, data }) => {
      const row = assets.get(where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }) => {
      const row = assets.get(where.id);
      if (!row || row.tenantId !== where.tenantId || (where.status && row.status !== where.status)
        || where.storageKey && row.storageKey !== where.storageKey
        || where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    }
  },
  fileUploadSession: {
    findFirst: async ({ where }) => [...sessions.values()].find((row) => row.tenantId === where.tenantId && (where.id ? row.id === where.id : row.idempotencyKey === where.idempotencyKey)) ?? null,
    findMany: async ({ where, select }) => {
      if (!where && select?.tenantId) {
        return [...new Set([...sessions.values()].map((row) => row.tenantId))].sort().map((id) => ({ tenantId: id }));
      }
      return [...sessions.values()].filter(row => matches(row, where)).slice(0, 100);
    },
    create: async ({ data }) => {
      const row = { ...data, createdAt: new Date(), updatedAt: new Date(), cleanupAttempts: 0, cleanupError: null, lastCleanupAt: null };
      sessions.set(row.id, row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = sessions.get(where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }) => {
      const row = sessions.get(where.id);
      const allowed = row && matches(row, where);
      if (!allowed) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date(), cleanupAttempts: (row.cleanupAttempts ?? 0) + (data.cleanupAttempts?.increment ?? 0) });
      return { count: 1 };
    }
  },
  $transaction: async (work) => {
    if (!Array.isArray(work) && forceCompletionRace) {
      forceCompletionRace = false;
      const pending = [...sessions.values()].find((row) => row.status === "pending_upload");
      if (pending) pending.status = "cleanup_in_progress";
    }
    if (Array.isArray(work)) return Promise.all(work);
    const assetBefore = structuredClone([...assets]), sessionBefore = structuredClone([...sessions]);
    try { return await work({ fileAsset: prisma.fileAsset, fileUploadSession: prisma.fileUploadSession }); }
    catch (error) {
      assets.clear(); assetBefore.forEach(([id, row]) => assets.set(id, row));
      sessions.clear(); sessionBefore.forEach(([id, row]) => sessions.set(id, row)); throw error;
    }
  }
};

const integrations = {
  runtimeConfig: async () => { if (beforeConfig) await beforeConfig(); return fileConfig; },
  assertEnabledInTransaction: async () => undefined
};
const access = new FileBusinessAccessService(prisma, new RentalCoreFactRepository(prisma),
  new RentalBusinessFactRepository(prisma), new CustomerOperationsService(prisma, {}, {}));
const runtime = new FileStorageRuntimeService(prisma, integrations, { record: async () => { if (duringAudit) await duringAudit(); } }, undefined, undefined, access);

void runWithRequestIdentity(operatorIdentity, async () => {
  const input = {
    businessModule: "rental-core",
    businessType: "rental_order",
    businessId: orderId,
    fileName: "contract.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    uploadScene: "order-contract",
    idempotencyKey: "upload-order-file-1"
  };
  const first = await runtime.createUploadSession(tenantId, input);
  assert.equal(first.fileAssetId.startsWith("file_"), true);
  assert.equal("storageKey" in first, false, "上传会话不得向调用方返回对象存储路径");

  const replay = await runtime.createUploadSession(tenantId, input);
  assert.equal(replay.sessionId, first.sessionId, "同一租户幂等重放必须复用原上传会话");
  await assert.rejects(
    () => runtime.createUploadSession(tenantId, { ...input, fileName: "another-contract.pdf" }),
    /幂等键已用于不同文件上传请求/u
  );

  await assert.rejects(
    () => runtime.createUploadSession(tenantId, { ...input, businessId: "order-from-other-tenant", idempotencyKey: "upload-order-file-2" }),
    /业务对象不存在或不属于当前租户/
  );

  const completed = await runtime.completeUpload(tenantId, first.sessionId, {});
  assert.equal(completed.status, "active");
  assert.equal("storageKey" in completed, false, "完成响应不得向调用方返回对象存储路径");
  const ownedUrl = await runtime.downloadUrl(tenantId, first.fileAssetId, { businessType: "rental_order", businessId: orderId, uploadScene: "order-contract" });
  assert.equal(ownedUrl.fileAssetId, first.fileAssetId);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      () => runtime.createUploadSession(tenantId, input),
      /生产环境禁止重放模拟文件上传/u,
      "生产环境不得通过幂等重放返回 local_mock 上传会话"
    );
    await assert.rejects(
      () => runtime.downloadUrl(tenantId, first.fileAssetId, { businessType: "rental_order", businessId: orderId, uploadScene: "order-contract" }),
      /生产环境禁止访问未归档的模拟文件/u,
      "生产环境不得为 local_mock 文件生成下载引用"
    );
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
  await assert.rejects(
    () => runtime.downloadUrl(tenantId, first.fileAssetId, { businessType: "customer", businessId: "other-customer", uploadScene: "client-qualification" }),
    /文件不存在或不属于当前业务对象/u
  );

  const qualificationSession = await runtime.createUploadSession(tenantId, {
    businessModule: "membership",
    businessType: "customer",
    businessId: "customer-file-test",
    fileName: "license.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    uploadScene: "client-qualification",
    idempotencyKey: "upload-client-qualification-1",
    metadata: { qualificationType: "driver_license" }
  }, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: "workspace-file-test" });
  await assert.rejects(
    () => runtime.createUploadSession(tenantId, {
      businessModule: "membership",
      businessType: "customer",
      businessId: "other-customer",
      fileName: "license.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      uploadScene: "client-qualification",
      idempotencyKey: "upload-client-qualification-1",
      metadata: { qualificationType: "driver_license" }
    }, { businessType: "customer", businessId: "other-customer", uploadScene: "client-qualification", workspaceId: "workspace-file-test" }),
    /幂等键已被其他业务对象使用/u
  );
  const qualificationFromOther = await runtime.createUploadSession(tenantId, {
    businessModule: "membership",
    businessType: "customer",
    businessId: "customer-file-test",
    fileName: "license-other-space.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    uploadScene: "client-qualification",
    idempotencyKey: "upload-client-other-workspace-1",
    metadata: { qualificationType: "driver_license" }
  }, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: otherWorkspaceId });
  assert.notEqual(qualificationFromOther.sessionId, qualificationSession.sessionId, "同租户会员可在另一空间上传新附件");
  await runtime.completeUpload(tenantId, qualificationFromOther.sessionId, {}, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId });
  const sharedReplay = await runtime.createUploadSession(tenantId, {
    businessModule: "membership",
    businessType: "customer",
    businessId: "customer-file-test",
    fileName: "license.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    uploadScene: "client-qualification",
    idempotencyKey: "upload-client-qualification-1",
    metadata: { qualificationType: "driver_license" }
  }, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: otherWorkspaceId });
  assert.equal(sharedReplay.sessionId, qualificationSession.sessionId, "跨空间幂等重放复用同一客户上传会话");
  assert.equal(sharedReplay.fileAssetId, qualificationSession.fileAssetId);
  await assert.rejects(
    () => runtime.completeUpload(tenantId, qualificationSession.sessionId, {}, { businessType: "customer", businessId: "other-customer", uploadScene: "client-qualification", workspaceId: "workspace-file-test" }),
    /上传会话不存在或不属于当前业务对象/u
  );
  await runtime.completeUpload(tenantId, qualificationSession.sessionId, {}, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: otherWorkspaceId });
  const qualificationUrl = await runtime.downloadUrl(tenantId, qualificationSession.fileAssetId, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: "workspace-file-test" });
  assert.equal(qualificationUrl.fileAssetId, qualificationSession.fileAssetId);
  const otherWorkspaceUrl = await runtime.downloadUrl(tenantId, qualificationSession.fileAssetId, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: otherWorkspaceId });
  assert.equal(otherWorkspaceUrl.fileAssetId, qualificationSession.fileAssetId, "客户附件跨空间下载成功");
  for (const ownerWorkspace of [workspaceId, otherWorkspaceId]) {
    await assert.rejects(
      () => runtime.downloadUrl(tenantId, qualificationSession.fileAssetId, { businessType: "customer", businessId: "other-customer", uploadScene: "client-qualification", workspaceId: ownerWorkspace }),
      /文件不存在或不属于当前业务对象/u,
      "共享范围不能扩大到其他客户"
    );
    await assert.rejects(
      () => runtime.downloadUrl(tenantId, qualificationSession.fileAssetId, { businessType: "customer", businessId: "customer-file-test", uploadScene: "another-scene", workspaceId: ownerWorkspace }),
      /文件不存在或不属于当前业务对象/u
    );
  }
  await assert.rejects(() => runtime.completeUpload(secondTenantId, qualificationSession.sessionId, {}), /上传会话不存在/u);
  await assert.rejects(() => runtime.downloadUrl(secondTenantId, qualificationSession.fileAssetId), /文件不存在或尚未完成上传/u);
  await assert.rejects(() => runtime.createUploadSession(secondTenantId, {
    ...input, businessModule: "membership", businessType: "customer", businessId: "customer-file-test", idempotencyKey: "foreign-customer-upload"
  }), /业务对象不存在或不属于当前租户/u);
  console.log("client file owner binding tests passed");

  const orderOwner = { businessType: "rental_order", businessId: orderId, uploadScene: "order-contract", workspaceId };
  const wrongOrderWorkspace = { ...orderOwner, workspaceId: otherWorkspaceId };
  assert.equal((await runtime.createUploadSession(tenantId, input, orderOwner)).sessionId, first.sessionId);
  for (const request of [input, { ...input, idempotencyKey: "wrong-space-new-order-upload" }]) {
    await assert.rejects(() => runtime.createUploadSession(tenantId, request, wrongOrderWorkspace), /业务对象不存在或不属于当前租户/u, "订单附件创建和重放都必须按空间隔离");
  }
  await assert.rejects(() => runtime.completeUpload(tenantId, first.sessionId, {}, wrongOrderWorkspace), /业务对象不存在或不属于当前租户/u);
  await assert.rejects(() => runtime.downloadUrl(tenantId, first.fileAssetId, wrongOrderWorkspace), /业务对象不存在或不属于当前租户/u);
  const inventoryInput = { ...input, businessType: "rental_asset", businessId: "inventory-file-test", idempotencyKey: "inventory-photo" };
  const inventoryOwner = { businessType: "rental_asset", businessId: "inventory-file-test", workspaceId };
  const inventorySession = await runtime.createUploadSession(tenantId, inventoryInput, inventoryOwner);
  await runtime.completeUpload(tenantId, inventorySession.sessionId, {}, inventoryOwner);
  await assert.rejects(() => runtime.downloadUrl(tenantId, inventorySession.fileAssetId, { ...inventoryOwner, workspaceId: otherWorkspaceId }), /业务对象不存在或不属于当前租户/u, "会员共享不得放开库存附件的空间边界");

  const raceSession = await runtime.createUploadSession(tenantId, {
    ...input,
    idempotencyKey: "upload-cleanup-race"
  });
  forceCompletionRace = true;
  await assert.rejects(
    () => runtime.completeUpload(tenantId, raceSession.sessionId, {}),
    /上传会话已失效，请重新上传/u
  );
  console.log("cleanup/complete race guard passed");

  const expiredAssetId = "file_expired";
  const expiredSessionId = "session_expired";
  assets.set(expiredAssetId, assetRow(expiredAssetId));
  sessions.set(expiredSessionId, {
    id: expiredSessionId,
    tenantId,
    fileAssetId: expiredAssetId,
    provider: "local_mock",
    storageKey: `tenant-files/${tenantId}/${expiredAssetId}/contract.pdf`,
    status: "pending_upload",
    idempotencyKey: "upload-expired",
    expiresAt: new Date(Date.now() - 1000),
    cleanupError: null,
    cleanupAttempts: 0
  });
  const cleanup = await runtime.cleanupExpiredUploadSessions(tenantId);
  assert.equal(cleanup.invalidated, 1);
  assert.equal(cleanup.deletedObjects, 1);
  assert.equal(sessions.get(expiredSessionId).status, "failed");
  assert.equal(assets.get(expiredAssetId).status, "failed");

  const secondExpiredAssetId = "file_expired_second_tenant";
  const secondExpiredSessionId = "session_expired_second_tenant";
  assets.set(secondExpiredAssetId, assetRow(secondExpiredAssetId, "pending_upload", secondTenantId, "order-file-test-2"));
  sessions.set(secondExpiredSessionId, {
    id: secondExpiredSessionId,
    tenantId: secondTenantId,
    fileAssetId: secondExpiredAssetId,
    provider: "local_mock",
    storageKey: `tenant-files/${secondTenantId}/${secondExpiredAssetId}/contract.pdf`,
    status: "pending_upload",
    idempotencyKey: "upload-expired-second-tenant",
    expiresAt: new Date(Date.now() - 1000),
    cleanupError: null,
    cleanupAttempts: 0
  });
  const scheduled = await runtime.cleanupExpiredUploadSessionsForAllTenants();
  assert.equal(scheduled.deletedObjects, 1, "跨租户调度应处理其他租户的过期对象");
  assert.equal(sessions.get(secondExpiredSessionId).status, "failed");
  assert.equal(assets.get(secondExpiredAssetId).status, "failed");
  const notReadable = error => [403, 404].includes(error?.status);
  const genericFile = assets.get(first.fileAssetId);
  const foreignFile = { ...assetRow('file-foreign', 'active'), businessId: 'order-another-space' };
  const notOwnedFile = { ...assetRow('file-not-owned', 'active'), businessId: 'order-another-owner' };
  const unknownFile = { ...assetRow('file-unknown', 'active'), businessType: 'unregistered' };
  const knowledgeFile = { ...assetRow('file-knowledge', 'active'), businessType: 'ai_knowledge_document' };
  [foreignFile, notOwnedFile, unknownFile, knowledgeFile].forEach(file => assets.set(file.id, file));
  assert.equal((await runtime.downloadUrl(tenantId, genericFile.id)).fileAssetId, genericFile.id, 'owner is not needed when original ACL grants the read');
  await assert.rejects(() => runtime.downloadUrl(tenantId, foreignFile.id), notReadable);
  await assert.rejects(() => inScope({ permissions: ['system:integration:manage'] }, () => runtime.downloadUrl(tenantId, genericFile.id)), notReadable);
  await assert.rejects(() => inScope({ workspaceId: otherWorkspaceId }, () => runtime.downloadUrl(tenantId, genericFile.id)), notReadable);
  await assert.rejects(() => inScope({ dataScope: 'own' }, () => runtime.downloadUrl(tenantId, notOwnedFile.id)), notReadable);
  await assert.rejects(() => inScope({ locationScope: { mode: 'selected', locationIds: ['other-place'] } }, () => runtime.downloadUrl(tenantId, genericFile.id)), notReadable);
  await assert.rejects(() => inScope({ dataScope: 'organization', locationScope: { mode: 'all', locationIds: [] } }, () => runtime.downloadUrl(tenantId, genericFile.id)), notReadable);
  await assert.rejects(() => inScope({ isSaasAdmin: true }, () => runtime.downloadUrl(tenantId, genericFile.id)), notReadable);
  await assert.rejects(() => runWithRequestIdentity({}, () => runtime.downloadUrl(tenantId, genericFile.id)), notReadable);
  await assert.rejects(() => runtime.downloadUrl(tenantId, unknownFile.id), notReadable);
  await assert.rejects(() => runtime.downloadUrl(tenantId, knowledgeFile.id), /知识附件必须/);

  await assert.rejects(() => inScope({ permissions: ['system:integration:manage', 'rental-os:member:view'] }, () => runtime.downloadUrl(tenantId, qualificationSession.fileAssetId)), notReadable);
  await assert.rejects(() => inScope({ dataScope: 'own', workspaceId: otherWorkspaceId }, () => runtime.downloadUrl(tenantId, qualificationSession.fileAssetId)), notReadable);
  const client = { audience: 'client', userId: 'customer-file-test', dataScope: undefined, permissions: undefined };
  assert.equal((await inScope(client, () => runtime.downloadUrl(tenantId, qualificationSession.fileAssetId))).fileAssetId, qualificationSession.fileAssetId);
  await assert.rejects(() => inScope({ ...client, userId: 'other-customer' }, () => runtime.downloadUrl(tenantId, qualificationSession.fileAssetId)), notReadable);
  const identityFile = { ...assetRow('file-identity', 'active'), businessType: 'customer', businessId: 'customer-file-test', uploadScene: 'identity-verification' };
  assets.set(identityFile.id, identityFile);
  await assert.rejects(() => runtime.downloadUrl(tenantId, identityFile.id), /当前授权的客户实名/);
  await assert.rejects(() => inScope({ permissions: ['system:integration:manage'] }, () => runtime.downloadUrl(tenantId, identityFile.id,
    { businessType: 'customer', businessId: 'customer-file-test', uploadScene: 'identity-verification' })), notReadable, 'a matching owner cannot grant sensitive access');

  const summary = file => ({ id: file.id, businessModule: file.businessModule, businessType: file.businessType, businessId: file.businessId,
    uploadScene: file.uploadScene, status: file.status, storageProvider: file.storageProvider, fileName: file.fileName,
    mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.createdAt.toISOString() });
  const candidates = [genericFile, foreignFile, unknownFile, identityFile, assets.get(qualificationSession.fileAssetId), knowledgeFile].map(summary);
  assert.deepEqual((await access.filterReadable(tenantId, candidates)).map(file => file.id), [genericFile.id]);
  assert.deepEqual(await inScope({ permissions: ['system:integration:manage'] }, () => access.filterReadable(tenantId, candidates)), []);
  assert.equal((await access.filterReadable(tenantId, [{ ...summary(genericFile), businessId: 'order-another-owner' }])).length, 0, 'a stale or forged summary cannot replace the original binding');
  const ledger = new IntegrationsService({ get: () => 'mysql' }, new IntegrationsRepository(prisma), access);
  const listed = await ledger.listFiles({ businessType: 'rental_order' });
  assert.equal(listed.some(file => file.id === foreignFile.id), false);
  assert.equal(listed.some(file => 'storageKey' in file || 'publicUrl' in file), false);
  for (const method of ['listNotificationTemplates', 'listNotificationLogs', 'listAdapterLogs', 'listJobs', 'listPrintJobs', 'listTBoxDevices']) ledger[method] = async () => [];
  assert.deepEqual((await ledger.getDashboard()).files.map(file => file.id), (await ledger.listFiles()).map(file => file.id), 'dashboard cannot bypass file ACL');
  const memoryLedger = new IntegrationsService({ get: () => 'memory' }, {}, access);
  memoryLedger.filesByTenant.set(tenantId, candidates);
  assert.deepEqual((await memoryLedger.listFiles()).map(file => file.id), [genericFile.id], 'memory listings do not have an allow-all fallback');
  await assert.rejects(() => new IntegrationsService({ get: () => 'mysql' }, {}).listFiles(), /权威未配置/);
  const missingAuthority = new FileStorageRuntimeService(prisma, integrations);
  await assert.rejects(() => missingAuthority.downloadUrl(tenantId, genericFile.id), /读取权威或访问审计未配置/);

  const evidenceFile = { ...assetRow('file-return-evidence', 'active'), uploadScene: 'return-evidence' };
  assets.set(evidenceFile.id, evidenceFile);
  await assert.rejects(() => inScope({ locationScope: { mode: 'selected', locationIds: ['pickup-place'] } }, () => runtime.downloadUrl(tenantId, evidenceFile.id)), notReadable, 'return evidence follows return location, not pickup access');
  assert.equal((await inScope({ audience: 'staff', permissions: ['rental-os:order:return'], locationScope: { mode: 'selected', locationIds: ['return-place'] } },
    () => runtime.downloadUrl(tenantId, evidenceFile.id))).fileAssetId, evidenceFile.id);
  const assetNotOwned = { ...assetRow('file-asset-not-owned', 'active'), businessType: 'rental_asset', businessId: 'inventory-not-owned' };
  assets.set(assetNotOwned.id, assetNotOwned);
  await assert.rejects(() => inScope({ dataScope: 'own' }, () => runtime.downloadUrl(tenantId, assetNotOwned.id)), notReadable);
  assert.equal((await inScope({ dataScope: 'own' }, () => runtime.downloadUrl(tenantId, inventorySession.fileAssetId))).fileAssetId, inventorySession.fileAssetId);
  const workFile = { ...assetRow('file-work', 'active'), businessType: 'rental_work_order', businessId: 'work-file', uploadScene: 'work-order-evidence' };
  assets.set(workFile.id, workFile);
  assert.equal((await inScope({ dataScope: 'own' }, () => runtime.downloadUrl(tenantId, workFile.id))).fileAssetId, workFile.id);
  await assert.rejects(() => inScope({ dataScope: 'own', userId: 'not-assigned' }, () => runtime.downloadUrl(tenantId, workFile.id)), notReadable);

  const publicImage = { ...assetRow('file-public-image', 'active'), businessType: 'item_group', businessId: catalogGroup.id, uploadScene: 'item-group-image' };
  assets.set(publicImage.id, publicImage);
  const guest = { tenantId, workspaceId, isSaasAdmin: false };
  assert.equal((await runWithRequestIdentity(guest, () => runtime.downloadUrl(tenantId, publicImage.id))).fileAssetId, publicImage.id);
  publicationEnabled = false;
  await assert.rejects(() => runWithRequestIdentity(guest, () => runtime.downloadUrl(tenantId, publicImage.id)), notReadable);
  publicationEnabled = true;
  catalogGroup.attributes.__itemGroupMedia.images = [];
  await assert.rejects(() => inScope(client, () => runtime.downloadUrl(tenantId, publicImage.id)), notReadable);
  catalogGroup.attributes.__itemGroupMedia.images = [{ fileAssetId: publicImage.id }];
  await assert.rejects(() => runWithRequestIdentity(guest, () => runtime.downloadUrl(tenantId, genericFile.id)), notReadable);

  const priorOrderId = genericFile.businessId;
  duringAudit = () => { genericFile.businessId = 'order-another-space'; };
  await assert.rejects(() => runtime.downloadUrl(tenantId, genericFile.id), /文件或读取授权已变化/);
  duringAudit = undefined;
  genericFile.businessId = priorOrderId;
  duringAudit = () => { getRequestIdentity().permissions = ['system:integration:manage']; };
  await assert.rejects(() => inScope({}, () => runtime.downloadUrl(tenantId, genericFile.id)), /文件或读取授权已变化/);
  duringAudit = undefined;
  const providerFile = { ...assetRow('file-provider', 'active'), storageProvider: 's3_compatible' };
  assets.set(providerFile.id, providerFile);
  fileConfig = { provider: 's3_compatible', settings: { endpoint: 'https://storage.example', bucket: 'files', region: 'us-east-1' },
    credentials: { accessKeyId: 'offline-key', secretAccessKey: 'offline-secret' } };
  beforeConfig = () => { orders[0].fulfillmentLocationId = 'other-place'; };
  await assert.rejects(() => inScope({ locationScope: { mode: 'selected', locationIds: ['pickup-place'] } }, () => runtime.downloadUrl(tenantId, providerFile.id)), notReadable);
  beforeConfig = undefined;
  orders[0].fulfillmentLocationId = 'pickup-place';
  const signed = await runtime.downloadUrl(tenantId, providerFile.id);
  assert.equal(signed.mode, 'provider');
  assert.equal(new Date(signed.expiresAt).getTime() - Date.now() <= 5 * 60 * 1000, true);
  fileConfig = undefined;
  const quoteFile = { ...assetRow('file-quote', 'active'), businessType: 'rental_quote', businessId: 'quote-file' };
  const reviewFile = { ...assetRow('file-review', 'active'), businessType: 'membership_review', businessId: 'review-file' };
  const corporateFile = { ...assetRow('file-corporate', 'active'), businessType: 'customer_contract', businessId: 'contract-file' };
  const printFile = { ...assetRow('file-print', 'active'), businessType: 'document_print_job', businessId: 'print-file', uploadScene: 'print_mock', metadata: { documentType: 'rental_contract' } };
  const cycleFile = { ...printFile, id: 'file-cycle', businessId: 'print-cycle' };
  const jobFile = { ...assetRow('file-job', 'active'), businessType: 'async_job', businessId: 'job-file' };
  [quoteFile, reviewFile, corporateFile, printFile, cycleFile, jobFile].forEach(file => assets.set(file.id, file));
  assert.equal((await runtime.downloadUrl(tenantId, quoteFile.id)).fileAssetId, quoteFile.id);
  await assert.rejects(() => inScope({ dataScope: 'own' }, () => runtime.downloadUrl(tenantId, quoteFile.id)), notReadable);
  await assert.rejects(() => inScope({ locationScope: { mode: 'selected', locationIds: ['pickup-place'] } }, () => runtime.downloadUrl(tenantId, quoteFile.id)), notReadable);
  assert.equal((await runtime.downloadUrl(tenantId, reviewFile.id)).fileAssetId, reviewFile.id);
  await assert.rejects(() => runtime.downloadUrl(tenantId, corporateFile.id), notReadable);
  assert.equal((await inScope({ permissions: [...operatorIdentity.permissions, 'rental-os:corporate:view'] }, () => runtime.downloadUrl(tenantId, corporateFile.id))).fileAssetId, corporateFile.id);
  assert.equal((await runtime.downloadUrl(tenantId, printFile.id)).fileAssetId, printFile.id);
  await assert.rejects(() => runtime.downloadUrl(tenantId, cycleFile.id), notReadable);
  await assert.rejects(() => runtime.downloadUrl(tenantId, jobFile.id), notReadable);
  const indirectSensitive = { ...printFile, id: 'file-indirect-sensitive', businessId: 'print-sensitive' };
  assets.set(indirectSensitive.id, indirectSensitive);
  assert.equal((await runtime.downloadUrl(tenantId, indirectSensitive.id)).fileAssetId, indirectSensitive.id);
  assert.equal((await access.filterReadable(tenantId, [summary(indirectSensitive)])).length, 0, 'a print-task wrapper cannot leak credential metadata');
  const guardUser = { id: 'file-operator', tenantId, isActive: true, isPlatformAdmin: false, isSaasAdmin: false,
    dataScope: 'organization', organizationId: 'org-file', permissions: operatorIdentity.permissions,
    locationScope: { mode: 'all', locationIds: [] } };
  const guard = new ApiAuthGuard({ resolveAccessContext: async () => ({ user: guardUser,
    tenantUser: { ...guardUser, dataScope: 'all' }, workspaceId, workspaceValid: true }) }, undefined, undefined, undefined,
    { organizationUnit: { findMany: async () => [{ id: 'org-file', parentId: null, status: 'enabled' }] },
      rentalFulfillmentLocation: { findMany: async () => [{ id: 'pickup-place' }] } });
  for (const url of ['/api/files', '/api/integrations/dashboard']) {
    await runWithRequestIdentity({}, async () => {
      assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method: 'GET', url, headers: { authorization: 'Bearer offline' } }) }) }), true);
      assert.deepEqual(getRequestIdentity().locationScope, { mode: 'selected', locationIds: ['pickup-place'] });
      assert.deepEqual(getRequestIdentity().permissions, guardUser.permissions);
      assert.equal(getRequestIdentity().isPlatformAdmin, false);
    });
  }
  const unregisteredScene = { ...assetRow('file-unregistered-scene', 'active'), uploadScene: 'unregistered-scene' };
  const invoiceFile = { ...assetRow('file-invoice', 'active'), uploadScene: 'print_mock', metadata: { documentType: 'invoice' } };
  assets.set(unregisteredScene.id, unregisteredScene);
  assets.set(invoiceFile.id, invoiceFile);
  await assert.rejects(() => runtime.downloadUrl(tenantId, unregisteredScene.id), notReadable);
  await assert.rejects(() => runtime.downloadUrl(tenantId, invoiceFile.id), notReadable);
  assert.equal((await inScope({ permissions: [...operatorIdentity.permissions, 'rental-os:finance:view'] }, () => runtime.downloadUrl(tenantId, invoiceFile.id))).fileAssetId, invoiceFile.id);
  duringAudit = () => { throw Error('audit persistence refused'); };
  await assert.rejects(() => runtime.downloadUrl(tenantId, qualificationSession.fileAssetId), /audit persistence refused/);
  duringAudit = undefined;
  console.log('file business ACL passed: original object, current scope, sensitive credentials, generic ledgers, staff stage, public publication, audited reads and pre-return rechecks');

  // Real membership/review methods with a transaction-shaped fixture; no DB.
  const membershipState = { reviews: [], revisions: [], refs: [] };
  let deleteBeforeWrite = false;
  const qualificationType = { id: 'type-license', tenantId, workspaceId, code: 'driver_license', categoryCode: 'CAMERA', status: 'enabled', requiredForBooking: true };
  const membershipDb = {
    ...prisma,
    customerProfile: { findFirst: async ({ where }) => where.tenantId === tenantId && where.id === 'customer-file-test'
      ? { id: where.id, tenantId, customerType: 'personal' } : null },
    customerMembership: { findUnique: async () => ({ id: 'membership-file', status: 'active' }) },
    customerMembershipQualificationType: { findFirst: async ({ where }) => matches(qualificationType, where) ? qualificationType : null },
    $queryRaw: async sql => { const id = sql.values[1]; const row = assets.get(id);
      return row && row.tenantId === sql.values[0] ? [structuredClone(row)] : []; },
    customerMembershipReview: {
      create: async ({ data }) => { const row = { id: `file-review-${membershipState.reviews.length}`, ...data, createdAt: new Date(), updatedAt: new Date() }; membershipState.reviews.push(row); return row; },
      findFirst: async ({ where }) => { const row = membershipState.reviews.find(row => matches(row, where)); return row && { ...row,
        customer: { name: 'Offline customer' }, qualificationRevision: membershipState.revisions.find(rev => rev.reviewId === row.id) }; },
      update: async ({ where, data }) => { const row = membershipState.reviews.find(row => matches(row, where)); Object.assign(row, data); return row; }
    },
    customerQualificationRevision: {
      create: async ({ data }) => { const row = { id: `file-revision-${membershipState.revisions.length}`, ...data, issuedAt: data.issuedAt ?? null,
        expiresAt: data.expiresAt ?? null, referenceNoMasked: data.referenceNoMasked ?? null, evidenceRef: data.evidenceRef ?? null, createdAt: new Date() }; membershipState.revisions.push(row); return row; },
      findFirst: async ({ where }) => membershipState.revisions.find(row => matches(row, where)) ?? null,
      update: async ({ where, data }) => { const row = membershipState.revisions.find(row => matches(row, where)); Object.assign(row, data); return row; }
    },
    customerQualificationRef: {
      upsert: async ({ create, update }) => { let row = membershipState.refs.find(row => row.qualificationType === create.qualificationType);
        if (!row) { row = { id: 'qualification-file', ...create, createdAt: new Date(), updatedAt: new Date() }; membershipState.refs.push(row); }
        else Object.assign(row, update); return row; },
      findFirst: async ({ where }) => membershipState.refs.find(row => matches(row, where)) ?? null,
      updateMany: async ({ where, data }) => { const rows = membershipState.refs.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; }
    },
    $transaction: async work => { const before = structuredClone(membershipState);
      if (deleteBeforeWrite) { deleteBeforeWrite = false; assets.get(qualificationSession.fileAssetId).status = 'deleted'; }
      try { return await work(membershipDb); } catch (error) { Object.assign(membershipState, before); throw error; } }
  };
  const membership = new MembershipService(membershipDb, { lockCustomerBusinessGate: async () => true }, new SharedCustomerRepository(membershipDb));
  const submit = (evidenceRef, channel = 'admin', workspace = workspaceId) => membership.submitQualification(tenantId, workspace,
    'customer-file-test', { qualificationType: 'driver_license', evidenceRef }, channel, 'file-operator');
  for (const channel of ['admin', 'app']) {
    for (const evidence of ['missing', first.fileAssetId, identityFile.id]) {
      const before = membershipState.reviews.length;
      await assert.rejects(() => submit(evidence, channel), /资质附件不存在/);
      assert.equal(membershipState.reviews.length, before);
    }
    const evidence = assets.get(qualificationSession.fileAssetId);
    evidence.metadata.qualificationType = 'wrong-type';
    await assert.rejects(() => submit(evidence.id, channel), /证件类型不匹配/);
    evidence.metadata.qualificationType = 'driver_license';
    evidence.status = 'pending_upload';
    await assert.rejects(() => submit(evidence.id, channel), /资质附件不存在/);
    evidence.status = 'active';
  }
  const firstQualification = await submit(qualificationSession.fileAssetId);
  assert.equal(firstQualification.review.qualificationSnapshot.evidenceRef, qualificationSession.fileAssetId);
  deleteBeforeWrite = true;
  const countBeforeDeletion = membershipState.reviews.length;
  await assert.rejects(() => submit(qualificationSession.fileAssetId), /资质附件不存在/);
  assert.equal(membershipState.reviews.length, countBeforeDeletion, 'evidence is rechecked inside the actual submission transaction');
  await assert.rejects(() => membership.review(tenantId, firstQualification.review.id, { status: 'approved' }, 'reviewer', { qualification: true, registration: false }), /资质附件不存在/);
  assert.equal(membershipState.reviews[0].status, 'pending', 'failed evidence check rolls back review status');
  assets.get(qualificationSession.fileAssetId).status = 'active';
  assert.equal((await membership.review(tenantId, firstQualification.review.id, { status: 'approved' }, 'reviewer', { qualification: true, registration: false })).status, 'approved');
  const noEvidence = await submit(undefined);
  assert.equal(noEvidence.review.qualificationSnapshot.evidenceRef, undefined, 'optional evidence is not invented');
  console.log('qualification evidence binding passed for admin/app, customer/type/scene/status, transaction-time deletion and original review rollback');
  // Provider transport is in-memory and explicit; the real presigner and
  // completion transactions run, without DNS/HTTP or claiming cloud validation.
  {
    const objectBytes = new Map(), requests = [];
    let afterRead, afterPut, beforeFreezeCommit;
    const originalObjectRequest = runtime.objectRequest;
    const originalTransaction = prisma.$transaction;
    runtime.objectRequest = async (url, init) => {
      const parsed = new URL(url), key = decodeURIComponent(parsed.pathname).replace(/^\//, '');
      requests.push({ method: init.method, key });
      if (init.method === 'PUT') {
        objectBytes.set(key, Buffer.from(init.body)); if (afterPut) await afterPut(key);
        return new Response(null, { status: 200 });
      }
      if (init.method === 'DELETE') { objectBytes.delete(key); return new Response(null, { status: 204 }); }
      if (init.method === 'HEAD') return new Response(null, { status: objectBytes.has(key) ? 200 : 404 });
      const bytes = objectBytes.get(key);
      if (!bytes) return new Response(null, { status: 404 });
      const copy = Buffer.from(bytes); if (afterRead) await afterRead(key);
      return new Response(copy, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(copy.length) } });
    };
    fileConfig = { id: 'offline-file-config', provider: 's3_compatible', capability: 'file',
      settings: { endpoint: 'https://storage.example', bucket: 'files', region: 'us-east-1' },
      credentials: { accessKeyId: 'offline-key', secretAccessKey: 'offline-secret' } };
    const owner = { businessType: 'rental_order', businessId: orderId, uploadScene: 'order-contract', workspaceId, actorUserId: 'file-operator' };
    const create = key => runtime.createUploadSession(tenantId, { ...input, sizeBytes: 4, idempotencyKey: key }, owner);
    const original = await create('immutable-original');
    const pendingKey = decodeURIComponent(new URL(original.uploadUrl).pathname).replace(/^\//, '');
    assert.ok(pendingKey.endsWith('.pending-upload'));
    const firstAsset = assets.get(original.fileAssetId);
    assert.notEqual(pendingKey, firstAsset.storageKey, 'PUT 不指向正式对象');
    objectBytes.set(pendingKey, Buffer.from('AAAA'));
    const replay = await create('immutable-original');
    assert.equal(replay.sessionId, original.sessionId); assert.ok(replay.uploadUrl); assert.deepEqual(replay.uploadHeaders, original.uploadHeaders);
    assert.equal(new URL(replay.uploadUrl).pathname, new URL(original.uploadUrl).pathname);
    assert.equal(replay.expiresAt, original.expiresAt, '原操作不续命');
    const originalPresign = runtime.presign;
    runtime.presign = (...args) => { const value = originalPresign.apply(runtime, args);
      sessions.get(original.sessionId).status = 'freeze_pending'; return value; };
    await assert.rejects(() => create('immutable-original'), /续签期间已变化/);
    runtime.presign = originalPresign; sessions.get(original.sessionId).status = 'pending_upload';
    const priorSettings = structuredClone(fileConfig.settings); fileConfig.settings.bucket = 'other-files';
    await assert.rejects(() => create('immutable-original'), /配置已变化/); fileConfig.settings = priorSettings;
    await assert.rejects(() => runtime.createUploadSession(tenantId, { ...input, sizeBytes: 4, idempotencyKey: 'immutable-original' },
      { ...owner, actorUserId: 'another-actor' }), /其他员工/);
    const digest = require('node:crypto').createHash('sha256').update('AAAA').digest('hex');
    await assert.rejects(() => runtime.completeUpload(tenantId, original.sessionId, { checksum: '0'.repeat(64) }, owner), /摘要与实际上传字节不一致/);
    assert.equal(sessions.get(original.sessionId).status, 'pending_upload');
    afterRead = key => { if (key === pendingKey) objectBytes.set(pendingKey, Buffer.from('BBBB')); };
    await runtime.completeUpload(tenantId, original.sessionId, { checksum: digest }, owner); afterRead = undefined;
    const completedAsset = assets.get(original.fileAssetId), completedKey = completedAsset.storageKey;
    assert.equal(completedAsset.checksum, digest); assert.equal(completedAsset.status, 'active');
    assert.equal(sessions.get(original.sessionId).storageKey, completedKey);
    assert.equal(objectBytes.get(completedKey).toString(), 'AAAA', '读取后临时内容竞态不改变同一冻结字节');
    objectBytes.set(pendingKey, Buffer.from('CCCC'));
    assert.equal(objectBytes.get(completedKey).toString(), 'AAAA', '完成后原 PUT 只能覆盖临时对象，fileId 的正式内容不变');
    const completedReplay = await create('immutable-original');
    assert.equal(completedReplay.status, 'completed'); assert.equal(completedReplay.uploadUrl, undefined);
    const downloaded = await runtime.downloadUrl(tenantId, original.fileAssetId, owner);
    assert.equal(decodeURIComponent(new URL(downloaded.downloadUrl).pathname).replace(/^\//, ''), completedKey);
    console.log('upload original recovery and immutable staging/content digest passed');

    const unknown = await create('immutable-unknown'), unknownKey = decodeURIComponent(new URL(unknown.uploadUrl).pathname).replace(/^\//, '');
    objectBytes.set(unknownKey, Buffer.from('DDDD'));
    afterPut = () => { afterPut = undefined; throw Error('PUT response lost after storage write'); };
    await assert.rejects(() => runtime.completeUpload(tenantId, unknown.sessionId, {}, owner), /PUT response lost/);
    const unknownSession = sessions.get(unknown.sessionId);
    assert.equal(unknownSession.status, 'freeze_pending');
    objectBytes.set(unknownKey, Buffer.from('EEEE'));
    unknownSession.expiresAt = new Date(Date.now() - 1000);
    const puts = requests.filter(row => row.method === 'PUT').length;
    assert.equal((await create('immutable-unknown')).uploadUrl, undefined);
    await runtime.completeUpload(tenantId, unknown.sessionId, {}, owner);
    assert.equal(requests.filter(row => row.method === 'PUT').length, puts, 'unknown 只读取原正式对象，不重发写入或重读临时内容');
    assert.equal(objectBytes.get(assets.get(unknown.fileAssetId).storageKey).toString(), 'DDDD');
    console.log('lost PUT response preserves original destination/hash and recovers read-only after TTL');

    const commitLost = await create('immutable-claim-lost'), commitLostKey = decodeURIComponent(new URL(commitLost.uploadUrl).pathname).replace(/^\//, '');
    objectBytes.set(commitLostKey, Buffer.from('FFFF'));
    prisma.$transaction = async work => { const result = await originalTransaction(work);
      if (beforeFreezeCommit && result?.session?.status === 'freeze_pending') { beforeFreezeCommit = false; throw Error('COMMIT response lost before PUT'); } return result; };
    beforeFreezeCommit = true;
    await assert.rejects(() => runtime.completeUpload(tenantId, commitLost.sessionId, {}, owner), /COMMIT response lost/);
    prisma.$transaction = originalTransaction;
    assert.equal(sessions.get(commitLost.sessionId).status, 'freeze_pending');
    const putsBeforeRecovery = requests.filter(row => row.method === 'PUT').length;
    await assert.rejects(() => runtime.completeUpload(tenantId, commitLost.sessionId, {}, owner), /类型或大小/);
    assert.equal(requests.filter(row => row.method === 'PUT').length, putsBeforeRecovery, '缺正式对象不是可重发的负收据');
    assert.equal((await create('immutable-claim-lost')).uploadUrl, undefined);
    console.log('lost original freeze commit never repeats an unproven object write');

    const expired = await create('immutable-expired'); sessions.get(expired.sessionId).expiresAt = new Date(Date.now() - 1000);
    const expiredReplay = await create('immutable-expired');
    assert.equal(expiredReplay.sessionId, expired.sessionId); assert.equal(expiredReplay.uploadUrl, undefined);
    const wrongBytes = await create('immutable-wrong-length'), wrongKey = decodeURIComponent(new URL(wrongBytes.uploadUrl).pathname).replace(/^\//, '');
    objectBytes.set(wrongKey, Buffer.from('short'));
    await assert.rejects(() => runtime.completeUpload(tenantId, wrongBytes.sessionId, {}, owner), /类型或大小/);
    assert.equal(sessions.get(wrongBytes.sessionId).status, 'pending_upload');
    const revoked = await create('immutable-revoked'), revokeKey = decodeURIComponent(new URL(revoked.uploadUrl).pathname).replace(/^\//, '');
    objectBytes.set(revokeKey, Buffer.from('GGGG'));
    const originalOrder = orders[0].workspaceId;
    afterRead = () => { orders[0].workspaceId = otherWorkspaceId; };
    await assert.rejects(() => runtime.completeUpload(tenantId, revoked.sessionId, {}, owner), /业务对象不存在/);
    afterRead = undefined; orders[0].workspaceId = originalOrder;
    assert.equal(assets.get(revoked.fileAssetId).status, 'pending_upload', '撤销原业务范围不能激活证据');
    assert.equal((await runtime.createUploadSession(tenantId, { ...input, sizeBytes: 4, idempotencyKey: 'immutable-original' }, owner)).uploadUrl, undefined);
    console.log('expired original grants and invalid length remain closed; revoked ownership never activates file');

    // Completed staging cleanup never changes the original completed/active
    // evidence and never consumes an uncertain freeze as a failed upload.
    const cleanable = sessions.get(original.sessionId);
    assert.equal(cleanable.cleanupError, 'completed_staging_pending');
    const deletesBeforeExpiry = requests.filter(row => row.method === 'DELETE').length;
    await runtime.cleanupCompletedStagingObjects(tenantId, 100);
    assert.equal(requests.some(row => row.method === 'DELETE' && row.key === pendingKey), false, 'live original PUT must expire before staging reclamation');
    cleanable.expiresAt = new Date(Date.now() - 1000);
    const metadataBeforeCleanup = structuredClone(completedAsset.metadata);
    await runtime.cleanupCompletedStagingObjects(tenantId, 100);
    assert.equal(requests.filter(row => row.method === 'DELETE' && row.key === pendingKey).length, 1);
    assert.equal(objectBytes.has(pendingKey), false); assert.equal(objectBytes.get(completedKey).toString(), 'AAAA');
    assert.equal(cleanable.status, 'completed'); assert.equal(cleanable.cleanupError, null);
    assert.equal(completedAsset.status, 'active'); assert.deepEqual(completedAsset.metadata, metadataBeforeCleanup);
    await runtime.cleanupCompletedStagingObjects(tenantId, 100);
    assert.equal(requests.filter(row => row.method === 'DELETE' && row.key === pendingKey).length, 1, 'recorded cleanup is not sent again');
    assert.ok(requests.filter(row => row.method === 'DELETE').length > deletesBeforeExpiry);
    assert.equal(requests.some(row => row.method === 'DELETE' && row.key === completedKey), false);
    assert.equal(requests.some(row => row.method === 'DELETE' && row.key === commitLostKey), false, 'unknown freeze is never staging cleanup');

    const cleanupUnknown = await create('immutable-cleanup-unknown');
    const cleanupUnknownKey = decodeURIComponent(new URL(cleanupUnknown.uploadUrl).pathname).replace(/^\//, '');
    objectBytes.set(cleanupUnknownKey, Buffer.from('HHHH'));
    await runtime.completeUpload(tenantId, cleanupUnknown.sessionId, {}, owner);
    const cleanupUnknownSession = sessions.get(cleanupUnknown.sessionId);
    cleanupUnknownSession.expiresAt = new Date(Date.now() - 1000);
    const objectFixture = runtime.objectRequest;
    let loseDelete = true;
    runtime.objectRequest = async (url, init) => {
      const response = await objectFixture(url, init);
      if (init.method === 'DELETE' && loseDelete) { loseDelete = false; throw Error('DELETE acknowledgement lost'); }
      return response;
    };
    const unknownCleanup = await runtime.cleanupCompletedStagingObjects(tenantId, 100);
    assert.equal(unknownCleanup.cleanupPending, 1); assert.equal(cleanupUnknownSession.cleanupError, 'completed_staging_unknown');
    assert.equal(cleanupUnknownSession.status, 'completed');
    cleanupUnknownSession.lastCleanupAt = new Date(Date.now() - 11 * 60 * 1000);
    const deleteCount = requests.filter(row => row.method === 'DELETE' && row.key === cleanupUnknownKey).length;
    await runtime.cleanupCompletedStagingObjects(tenantId, 100);
    assert.equal(cleanupUnknownSession.cleanupError, null);
    assert.equal(requests.filter(row => row.method === 'DELETE' && row.key === cleanupUnknownKey).length, deleteCount);
    assert.ok(requests.some(row => row.method === 'HEAD' && row.key === cleanupUnknownKey));
    runtime.objectRequest = objectFixture;

    const claimUnknown = await create('immutable-cleanup-claim-lost');
    const claimUnknownKey = decodeURIComponent(new URL(claimUnknown.uploadUrl).pathname).replace(/^\//, '');
    objectBytes.set(claimUnknownKey, Buffer.from('IIII'));
    await runtime.completeUpload(tenantId, claimUnknown.sessionId, {}, owner);
    const claimSession = sessions.get(claimUnknown.sessionId); claimSession.expiresAt = new Date(Date.now() - 1000);
    let loseClaim = true;
    prisma.$transaction = async work => { const result = await originalTransaction(work);
      if (loseClaim && result?.count === 1) { loseClaim = false; throw Error('cleanup COMMIT acknowledgement lost'); } return result; };
    await runtime.cleanupCompletedStagingObjects(tenantId, 100); prisma.$transaction = originalTransaction;
    assert.equal(claimSession.cleanupError, 'completed_staging_unknown');
    claimSession.lastCleanupAt = new Date(Date.now() - 11 * 60 * 1000);
    await runtime.cleanupCompletedStagingObjects(tenantId, 100);
    assert.equal(requests.some(row => row.method === 'DELETE' && row.key === claimUnknownKey), false, 'uncertain claim cannot authorize a later DELETE');
    assert.equal(claimSession.cleanupError, 'completed_staging_unknown', 'HEAD 200 never proves deletion');
    assert.equal(assets.get(claimUnknown.fileAssetId).status, 'active');

    // An old completed row, a changed location or a forged staging path cannot
    // be promoted to trusted evidence by this maintenance entry.
    const cleanupBlocked = await create('immutable-cleanup-blocked');
    const blockedKey = decodeURIComponent(new URL(cleanupBlocked.uploadUrl).pathname).replace(/^\//, '');
    objectBytes.set(blockedKey, Buffer.from('JJJJ'));
    await runtime.completeUpload(tenantId, cleanupBlocked.sessionId, {}, owner);
    const blockedSession = sessions.get(cleanupBlocked.sessionId), blockedAsset = assets.get(cleanupBlocked.fileAssetId);
    blockedSession.expiresAt = new Date(Date.now() - 1000);
    const blockedMetadata = structuredClone(blockedAsset.metadata), oldBucket = fileConfig.settings.bucket;
    fileConfig.settings.bucket = 'changed-files'; await runtime.cleanupCompletedStagingObjects(tenantId, 100); fileConfig.settings.bucket = oldBucket;
    assert.equal(blockedSession.cleanupError, 'completed_staging_pending');
    blockedAsset.metadata.stagingStorageKey = 'another/original'; await runtime.cleanupCompletedStagingObjects(tenantId, 100);
    assert.equal(requests.some(row => row.method === 'DELETE' && row.key === blockedKey), false);
    blockedAsset.metadata = blockedMetadata;
    const legacy = { ...blockedSession, id: 'legacy-completed', fileAssetId: 'legacy-file', cleanupError: null };
    sessions.set(legacy.id, legacy); assets.set(legacy.fileAssetId, { ...blockedAsset, id: legacy.fileAssetId, metadata: { uploadMode: 'provider' } });
    const integrated = await runtime.cleanupExpiredUploadSessions(tenantId);
    assert.equal(integrated.sessionIds.includes(legacy.id), false);
    assert.equal(legacy.status, 'completed'); assert.equal(blockedAsset.status, 'active');
    assert.equal(blockedSession.cleanupError, null); assert.equal(objectBytes.has(blockedKey), false);
    assert.equal(sessions.get(commitLost.sessionId).status, 'freeze_pending');
    assert.equal(objectBytes.get(completedKey).toString(), 'AAAA');
    console.log('completed staging cleanup waits for original expiry, preserves evidence and observes uncertain DELETE/COMMIT without resending');
    runtime.objectRequest = originalObjectRequest; fileConfig = undefined;
  }
  const { RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE: scene } = require('../packages/shared/dist');
  const declaration = { ...input, fileName:'condition.png', mimeType:'image/png', sizeBytes:68, uploadScene:scene, idempotencyKey:'exchange-image-original' };
  await assert.rejects(runtime.createUploadSession(tenantId, declaration), /专用/u);
  const owner = { businessType:'rental_order', businessId:orderId, uploadScene:scene, workspaceId, actorUserId:'operator', exchangeInspectionSourceId:'source-original' };
  const config = { id:'storage-config', provider:'s3_compatible', capability:'file', settings:{ bucket:'images', region:'us-east-1', endpoint:'https://storage.example.invalid', forcePathStyle:true }, credentials:{ accessKeyId:'offline-placeholder', secretAccessKey:'offline-placeholder' } };
  const configRow = { ...config, tenantId, enabled:true, isDefault:true, lastTestStatus:'passed', lastTestMode:'live', updatedAt:new Date(0) }; delete configRow.credentials;
  const dedicatedDb = { ...prisma, tenantIntegrationConfig:{ findFirst:async () => structuredClone(configRow) }, fileAsset:{ ...prisma.fileAsset,
    findFirst:async args => { const row=await prisma.fileAsset.findFirst(args); return row && (!args.where.uploadedBy || row.uploadedBy===args.where.uploadedBy) ? structuredClone({ ...row, ...(args.include?.uploadSession ? { uploadSession:[...sessions.values()].find(session=>session.fileAssetId===row.id) } : {}) }) : null; } } };
  dedicatedDb.$transaction = async fn => fn(dedicatedDb);
  const dedicated = new FileStorageRuntimeService(dedicatedDb, { runtimeConfig:async () => structuredClone(config), assertEnabledInTransaction:async () => undefined });
  const plan = await dedicated.planExchangeInspectionUpload(tenantId,declaration,owner);
  assert.ok(plan.uploadUrl); await dedicated.persistExchangeInspectionUpload(dedicatedDb,tenantId,plan);
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const originalFetch=globalThis.fetch, originalEgress=require('../apps/api/src/common/outbound-url').assertOutboundUrl;
  const egress=require('../apps/api/src/common/outbound-url'); egress.assertOutboundUrl=async url=>new URL(url);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=','base64');
  assert.equal(png.length,68); let byteRequests=0;
  globalThis.fetch=async () => { byteRequests++; return new Response(png,{ headers:{'content-length':'68','content-type':'image/png'} }); };
  try {
    await assert.rejects(dedicated.inspectExchangeInspectionUpload(tenantId,plan.assetId,{...owner,workspaceId:otherWorkspaceId},plan.configRowHash,plan.storageLocationHash),/归属/u);
    const proof=await dedicated.inspectExchangeInspectionUpload(tenantId,plan.assetId,owner,plan.configRowHash,plan.storageLocationHash);
    assert.equal(proof.contentHash,require('node:crypto').createHash('sha256').update(png).digest('hex')); assert.equal(proof.width,1); assert.equal(byteRequests,1);
    await assert.rejects(dedicated.completeUpload(tenantId,plan.sessionId,{},owner),/专用/u);
    await assert.rejects(dedicated.deleteFileAsset(tenantId,plan.assetId,owner),/专用/u);
    sessions.get(plan.sessionId).expiresAt=new Date(0);
    const retained=await dedicated.cleanupExpiredUploadSessions(tenantId); assert.ok(!retained.sessionIds.includes(plan.sessionId));
    assert.equal(sessions.get(plan.sessionId).status,'pending_upload'); assert.equal(assets.get(plan.assetId).status,'pending_upload');
    sessions.get(plan.sessionId).expiresAt=plan.expiresAt;
    const completion=await dedicated.completeExchangeInspectionUpload(dedicatedDb,tenantId,plan.assetId,owner,proof);
    assert.equal(completion.contentHash,proof.contentHash); assert.equal(assets.get(plan.assetId).status,'active');
    await assert.rejects(dedicated.downloadUrl(tenantId,plan.assetId),/专用/u);
    const second=await dedicated.planExchangeInspectionUpload(tenantId,{...declaration,idempotencyKey:'image-second'}, {...owner,exchangeInspectionSourceId:'source-second'});
    await dedicated.persistExchangeInspectionUpload(dedicatedDb,tenantId,second);
    globalThis.fetch=async () => new Response(Buffer.alloc(68),{ headers:{'content-length':'68','content-type':'image/png'} });
    await assert.rejects(dedicated.inspectExchangeInspectionUpload(tenantId,second.assetId,{...owner,exchangeInspectionSourceId:'source-second'},second.configRowHash,second.storageLocationHash));
    assert.equal(assets.get(second.assetId).status,'pending_upload');
    configRow.updatedAt=new Date(1); await assert.rejects(dedicated.persistExchangeInspectionUpload(dedicatedDb,tenantId,second),/配置/u);
    const { IntegrationsRepository }=require('../apps/api/src/modules/integrations/integrations.repository'); let listWhere;
    const repository=new IntegrationsRepository({ fileAsset:{findMany:async ({where})=>{listWhere=where;return [];} } });
    await repository.listFiles(tenantId,{uploadScene:scene}); assert.equal(listWhere.NOT.uploadScene,scene);
    await assert.rejects(repository.createFile(declaration,tenantId),/专用/u);
    const { IntegrationsService }=require('../apps/api/src/modules/integrations/integrations.service');
    const service=new IntegrationsService({get:()=> 'memory'},repository); await assert.rejects(service.createFile(declaration),/专用/u);
    assert.ok(requestFingerprint(proof));
  } finally { globalThis.fetch=originalFetch; egress.assertOutboundUrl=originalEgress; }
  console.log("dedicated exchange image bytes, generic isolation and unknown TTL retention passed");
  console.log("file storage lifecycle tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
