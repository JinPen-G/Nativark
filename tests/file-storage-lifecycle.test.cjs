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

const tenantId = "tenant-file-test";
const secondTenantId = "tenant-file-test-2";
const orderId = "order-file-test";
const assets = new Map();
const sessions = new Map();
let assetSequence = 0;
let forceCompletionRace = false;

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
  rentalOrder: { findFirst: async ({ where }) => where.tenantId === tenantId && where.id === orderId ? { id: orderId } : null },
  customerProfile: { findFirst: async ({ where }) => where.tenantId === tenantId && where.id === "customer-file-test" ? { id: where.id } : null },
  customerWorkspaceLink: { findFirst: async ({ where }) => where.tenantId === tenantId && where.workspaceId === "workspace-file-test" && where.customerId === "customer-file-test" && where.status === "active" ? { id: "link-file-test" } : null },
  fileAsset: {
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
      if (!row || row.tenantId !== where.tenantId || (where.status && row.status !== where.status)) return { count: 0 };
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
      return [...sessions.values()].filter((row) => row.tenantId === where.tenantId && row.expiresAt <= where.expiresAt.lte && (row.status === "pending_upload" || (row.status === "failed" && row.cleanupError))).slice(0, 100);
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
      const allowed = row
        && row.tenantId === where.tenantId
        && (!where.status || row.status === where.status)
        && (where.status || row.status === "pending_upload" || (row.status === "failed" && row.cleanupError));
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
    return Array.isArray(work) ? Promise.all(work) : work({ fileAsset: prisma.fileAsset, fileUploadSession: prisma.fileUploadSession });
  }
};

const integrations = {
  runtimeConfig: async () => undefined,
  assertEnabledInTransaction: async () => undefined
};
const runtime = new FileStorageRuntimeService(prisma, integrations);

void (async () => {
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
  await assert.rejects(
    () => runtime.createUploadSession(tenantId, {
      businessModule: "membership",
      businessType: "customer",
      businessId: "customer-file-test",
      fileName: "license-other-space.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      uploadScene: "client-qualification",
      idempotencyKey: "upload-client-other-workspace-1",
      metadata: { qualificationType: "driver_license" }
    }, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: "workspace-other" }),
    /业务对象不存在或不属于当前租户/u
  );
  await assert.rejects(
    () => runtime.createUploadSession(tenantId, {
      businessModule: "membership",
      businessType: "customer",
      businessId: "customer-file-test",
      fileName: "license.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 2048,
      uploadScene: "client-qualification",
      idempotencyKey: "upload-client-qualification-1",
      metadata: { qualificationType: "driver_license" }
    }, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: "workspace-other" }),
    /业务对象不存在或不属于当前租户/u
  );
  await assert.rejects(
    () => runtime.completeUpload(tenantId, qualificationSession.sessionId, {}, { businessType: "customer", businessId: "other-customer", uploadScene: "client-qualification", workspaceId: "workspace-file-test" }),
    /上传会话不存在或不属于当前业务对象/u
  );
  await runtime.completeUpload(tenantId, qualificationSession.sessionId, {}, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: "workspace-file-test" });
  const qualificationUrl = await runtime.downloadUrl(tenantId, qualificationSession.fileAssetId, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: "workspace-file-test" });
  assert.equal(qualificationUrl.fileAssetId, qualificationSession.fileAssetId);
  await assert.rejects(
    () => runtime.downloadUrl(tenantId, qualificationSession.fileAssetId, { businessType: "customer", businessId: "customer-file-test", uploadScene: "client-qualification", workspaceId: "workspace-other" }),
    /文件不存在或不属于当前业务对象|业务对象不存在或不属于当前租户/u
  );
  console.log("client file owner binding tests passed");

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
  console.log("file storage lifecycle tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
