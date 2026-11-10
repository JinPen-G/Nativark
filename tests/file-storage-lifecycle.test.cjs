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
const workspaceId = "workspace-file-test";
const otherWorkspaceId = "workspace-other";
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
  rentalOrder: { findFirst: async ({ where }) => where.tenantId === tenantId && where.id === orderId && (!where.workspaceId || where.workspaceId === workspaceId) ? { id: orderId } : null },
  rentalAsset: { findFirst: async ({ where }) => where.tenantId === tenantId && where.id === "inventory-file-test" && (!where.workspaceId || where.workspaceId === workspaceId) ? { id: where.id } : null },
  customerProfile: { findFirst: async ({ where }) => where.tenantId === tenantId && ["customer-file-test", "other-customer"].includes(where.id) ? { id: where.id } : null },
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
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
