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
    if (key === "fileAsset" && value?.is) return Boolean(assets.get(row.fileAssetId)) && matches(assets.get(row.fileAssetId), value.is);
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
    storageKey: `tenant-files/${assetTenantId}/${id}/contract.pdf`,
    publicUrl: null,
    checksum: null,
    uploadScene: "order-contract",
    status,
    uploadedBy: null,
    metadata: { uploadMode: "simulation" },
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

const prisma = {
  $queryRaw: async query => {
    if (query.sql.includes("FROM Tenant")) return [tenantId, secondTenantId].includes(query.values[0]) ? [{ id: query.values[0] }] : [];
    const sql = query.sql.replace(/\s+/gu, " ").trim();
    if (/^SELECT id FROM (file_upload_sessions|FileAsset) WHERE tenantId=\? AND id=\? (FOR UPDATE|LOCK IN SHARE MODE)$/u.test(sql)) {
      assert.equal(query.values.length, 2);
      const rows = sql.includes("FROM file_upload_sessions") ? sessions : assets;
      const row = rows.get(query.values[1]);
      return row?.tenantId === query.values[0] ? [{ id: row.id }] : [];
    }
    throw new Error("unexpected file storage SQL");
  },
  operationLog: { create: async () => { if (duringAudit) await duringAudit(); } },
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
    ? { id: workspaceId, tenantId, status: "ACTIVE", categoryCode: "CAMERA" } : null },
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
      return row && matches(row, where) ? row : null;
    },
    update: async ({ where, data }) => {
      const row = assets.get(where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }) => {
      const row = assets.get(where.id);
      if (!row || !matches(row, where)) return { count: 0 };
      Object.assign(row, data, { updatedAt: data.updatedAt ?? new Date() });
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
      const row = { ...data, completedAt: null, failureReason: null, createdAt: new Date(), updatedAt: new Date(), cleanupAttempts: 0, cleanupError: null, lastCleanupAt: null };
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
      Object.assign(row, data, { updatedAt: data.updatedAt ?? new Date(), cleanupAttempts: (row.cleanupAttempts ?? 0) + (data.cleanupAttempts?.increment ?? 0) });
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
    try { return await work({ ...prisma }); }
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

/** 原Rental删除入口、公共占用/结果事务和原键HEAD，运输仅使用明确内存应答。 */
async function pendingFileDeleteBoundaries() {
  const { fileStorageLocationHash } = require('@rental-os/platform-contracts/file-content-binding');
  const saved = { transaction: prisma.$transaction, deleteObject: runtime.deleteObject,
    objectRequest: runtime.objectRequest, fileConfig, beforeConfig, duringAudit, workspace: orders[0].workspaceId };
  function fixture(status = 'active') {
    assets.clear(); sessions.clear(); beforeConfig = undefined; duringAudit = undefined;
    orders[0].workspaceId = saved.workspace;
    fileConfig = { id: 'original-delete-config', capability: 'file', provider: 's3_compatible',
      settings: { endpoint: 'https://storage.example.invalid', bucket: 'files', region: 'us-east-1' },
      credentials: { accessKeyId: 'offline', secretAccessKey: 'offline-only' }, revision: { updatedAt: new Date(1) } };
    const asset = { ...assetRow('delete-original', status), storageProvider: fileConfig.provider,
      metadata: { workspaceId, storageLocationHash: fileStorageLocationHash(fileConfig) } };
    assets.set(asset.id, asset);
    const owner = { businessType: asset.businessType, businessId: asset.businessId, uploadScene: asset.uploadScene, workspaceId };
    const state = { asset, owner, requests: [], exists: true, transactions: 0, loseDelete: false,
      loseCommitAt: 0, failResultAt: 0, revokeAt: 0 };
    prisma.$transaction = async (work, options) => {
      const number = ++state.transactions;
      if (number === state.revokeAt) orders[0].workspaceId = otherWorkspaceId;
      const result = await saved.transaction(async tx => {
        const value = await work(tx);
        if (number === state.failResultAt) throw Error('original result transaction rolled back');
        return value;
      }, options);
      if (number === state.loseCommitAt) throw Error('original transaction acknowledgement lost');
      return result;
    };
    runtime.deleteObject = async (config, key) => {
      assert.equal(config.id, fileConfig.id);
      assert.equal(key, asset.storageKey);
      assert.equal(assets.get(asset.id).status, 'delete_in_progress', 'DELETE follows persisted original claim');
      state.requests.push('DELETE'); state.exists = false;
      if (state.loseDelete) throw Error('original DELETE acknowledgement lost');
      return true;
    };
    runtime.objectRequest = async (url, init) => {
      assert.equal(init.method, 'HEAD');
      assert(decodeURIComponent(new URL(url).pathname).endsWith(`/${asset.storageKey}`));
      state.requests.push('HEAD');
      return new Response(null, { status: state.exists ? 200 : 404 });
    };
    state.remove = () => runtime.deleteFileAsset(tenantId, asset.id, owner);
    state.cleanup = () => runtime.cleanupPendingFileAssetDeletes(tenantId);
    return state;
  }

  /** 公共应用消费登记的非Rental文件权威，Core、配置和运输使用明确夹具。 */
  function createPublicFixture(status) {
    const { FileStorageApplication } = require('@rental-os/platform-server/files');
    const state = fixture(status);
    Object.assign(state.asset, { businessModule: 'fixture-core', businessType: 'fixture_object',
      businessId: 'original-object', uploadScene: 'attachment' });
    state.coreEnabled = true;
    state.configurationEnabled = true;
    state.coreChecks = 0;
    state.configurationChecks = 0;
    state.boundaries = [];
    const authority = {
      binding: { businessModule: 'fixture-core', businessType: 'fixture_object', uploadScene: 'attachment' },
      authorityKey: () => String(state.coreEnabled),
      assertUpload: async () => { if (!state.coreEnabled) throw Error('Current Core is stopped'); },
      assertAsset: async context => {
        assert.equal(context.tenantId, tenantId);
        assert.equal(context.asset.businessId, 'original-object');
        if (!state.coreEnabled) throw Error('Current Core is stopped');
      },
      isTenantSharedBinding: () => false
    };
    const application = new FileStorageApplication({
      store: prisma,
      transaction: async (work, boundary) => {
        state.coreChecks++;
        if (boundary) {
          assert.equal(boundary.asset.tenantId, tenantId);
          state.boundaries.push({ operation: boundary.operation, phase: boundary.phase });
        }
        if (!state.coreEnabled) throw Error('Current Core is stopped');
        const result = await prisma.$transaction(work, { isolationLevel: 'ReadCommitted' });
        await state.afterTransaction?.();
        return result;
      },
      runtimeConfig: async () => { await state.onConfig?.(); return structuredClone(fileConfig); },
      assertEnabled: async (tx, currentTenant, config) => {
        assert.equal(typeof tx.fileAsset.findFirst, 'function');
        assert.equal(currentTenant, tenantId);
        assert.equal(config.id, fileConfig.id);
        state.configurationChecks++;
        if (!state.configurationEnabled) throw Error('Original configuration is disabled');
      },
      allowSimulation: false, isUniqueConflict: () => false, excludedUploadScene: undefined
    }, [authority]);
    application.deleteObject = runtime.deleteObject;
    application.objectRequest = runtime.objectRequest;
    return { application, state };
  }

  async function createPublicUpload() {
    const fixture = createPublicFixture('pending_upload');
    const { application, state } = fixture;
    assets.clear(); sessions.clear();
    const objects = new Map(), bytes = Buffer.alloc(1024, 42);
    application.presign = (config, method, key) => ({
      url: 'https://storage.example.invalid/' + encodeURIComponent(key), headers: {}
    });
    application.readObjectContent = async (config, key) => {
      assert.equal(config.id, fileConfig.id);
      if (key === state.originalKey + '.pending-upload') return Buffer.from(bytes);
      if (!objects.has(key)) throw Error('Original committed object is absent');
      return Buffer.from(objects.get(key));
    };
    application.objectRequest = async (url, init) => {
      assert.equal(init.method, 'PUT');
      const key = decodeURIComponent(new URL(url).pathname.slice(1));
      state.requests.push('PUT'); objects.set(key, Buffer.from(init.body));
      if (state.losePutReply) throw Error('Original PUT acknowledgement lost');
      return new Response('', { status: 200 });
    };
    const request = {
      businessModule: 'fixture-core', businessType: 'fixture_object', businessId: 'original-object',
      uploadScene: 'attachment', fileName: 'contract.pdf', mimeType: 'application/pdf',
      sizeBytes: bytes.length, idempotencyKey: 'public-original-upload'
    };
    const grant = await application.createUploadSession(tenantId, request);
    state.asset = assets.get(grant.fileAssetId);
    state.originalKey = state.asset.storageKey;
    return { ...fixture, grant, request };
  }
  try {
    const lost = fixture(); lost.loseDelete = true;
    await assert.rejects(lost.remove, /原文件删除结果尚未证实/u);
    assert.equal(assets.get(lost.asset.id).status, 'delete_in_progress');
    assert.equal((await lost.cleanup()).deleted, 1);
    assert.deepEqual(lost.requests, ['DELETE', 'HEAD']);
    assert.equal(assets.get(lost.asset.id).status, 'deleted');

    const queued = fixture('delete_queued');
    assert.equal((await queued.cleanup()).deleted, 1);
    assert.deepEqual(queued.requests, ['DELETE'], 'acknowledged unlink queue still dispatches its first DELETE');

    const legacy = fixture('delete_pending');
    await assert.rejects(legacy.remove, /原文件删除结果尚未证实/u);
    assert.equal(assets.get(legacy.asset.id).status, 'delete_pending');
    legacy.exists = false;
    assert.equal((await legacy.cleanup()).deleted, 1);
    assert.deepEqual(legacy.requests, ['HEAD', 'HEAD'], 'legacy pending cannot establish a new DELETE receipt');

    const enqueueLost = fixture(); enqueueLost.loseCommitAt = 1;
    await assert.rejects(enqueueLost.remove, /acknowledgement lost/u);
    assert.equal(assets.get(enqueueLost.asset.id).status, 'delete_queued');
    assert.equal(enqueueLost.requests.length, 0);
    enqueueLost.loseCommitAt = 0;
    assert.equal((await enqueueLost.cleanup()).deleted, 1);
    assert.deepEqual(enqueueLost.requests, ['DELETE']);

    const claimLost = fixture(); claimLost.loseCommitAt = 2;
    await assert.rejects(claimLost.remove, /原文件删除结果尚未证实/u);
    assert.equal(assets.get(claimLost.asset.id).status, 'delete_in_progress');
    claimLost.loseCommitAt = 0;
    assert.equal((await claimLost.cleanup()).pending, 1);
    await assert.rejects(claimLost.remove, /原文件删除结果尚未证实/u);
    assert.deepEqual(claimLost.requests, ['HEAD', 'HEAD'], 'unacknowledged claim and repeated caller never resend DELETE');

    for (const failure of ['loseCommitAt', 'failResultAt']) {
      const resultLost = fixture(); resultLost[failure] = 4;
      await assert.rejects(resultLost.remove, /原文件删除结果尚未证实/u);
      assert.equal(assets.get(resultLost.asset.id).status, failure === 'loseCommitAt' ? 'deleted' : 'delete_in_progress');
      resultLost[failure] = 0;
      assert.equal((await resultLost.remove()).status, 'deleted');
      assert.deepEqual(resultLost.requests, failure === 'loseCommitAt' ? ['DELETE'] : ['DELETE', 'HEAD']);
    }

    const revoked = fixture(); revoked.revokeAt = 3;
    await assert.rejects(revoked.remove, /原文件删除结果尚未证实/u);
    assert.equal(revoked.requests.length, 0, 'original business reference is rechecked immediately before DELETE');
    assert.equal(assets.get(revoked.asset.id).status, 'delete_queued');

    const isolated = fixture();
    const other = { ...assetRow('delete-other', 'delete_queued'), storageProvider: fileConfig.provider,
      metadata: { storageLocationHash: fileStorageLocationHash(fileConfig) } };
    assets.set(other.id, other);
    assert.equal((await isolated.remove()).status, 'deleted');
    assert.equal(assets.get(other.id).status, 'delete_queued', 'single-file request never scans another queued target');
    assert.deepEqual(isolated.requests, ['DELETE']);

    const local = fixture(); local.asset.storageProvider = 'local_mock';
    assert.equal((await local.remove()).status, 'deleted');
    assert.equal(local.requests.length, 0);
    console.log('file deletion: single DELETE, original HEAD, legacy pending, commit loss, current binding and target isolation passed');

    const publicNormal = createPublicFixture('delete_queued');
    assert.equal((await publicNormal.application.cleanup.cleanupPendingFileAssetDeletes(tenantId)).deleted, 1);
    assert.deepEqual(publicNormal.state.requests, ['DELETE']);
    assert.equal(publicNormal.state.configurationChecks, 1);
    assert.deepEqual(publicNormal.state.boundaries, [
      { operation: 'pending_delete', phase: 'claim' }, { operation: 'pending_delete', phase: 'prepare' }
    ]);

    const publicStopped = createPublicFixture('delete_queued');
    publicStopped.state.onConfig = async () => { publicStopped.state.coreEnabled = false; };
    assert.equal((await publicStopped.application.cleanup.cleanupPendingFileAssetDeletes(tenantId)).pending, 1);
    assert.deepEqual(publicStopped.state.requests, []);
    assert.equal(assets.get(publicStopped.state.asset.id).status, 'delete_queued');

    const publicDisabledConfig = createPublicFixture('delete_queued');
    publicDisabledConfig.state.onConfig = async () => { publicDisabledConfig.state.configurationEnabled = false; };
    await publicDisabledConfig.application.cleanup.cleanupPendingFileAssetDeletes(tenantId);
    assert.deepEqual(publicDisabledConfig.state.requests, []);
    assert.equal(publicDisabledConfig.state.configurationChecks, 1);

    const publicChangedLocation = createPublicFixture('delete_queued');
    publicChangedLocation.state.onConfig = async () => { fileConfig.settings.bucket = 'changed-location'; };
    await publicChangedLocation.application.cleanup.cleanupPendingFileAssetDeletes(tenantId);
    assert.deepEqual(publicChangedLocation.state.requests, []);

    const publicChangedVersion = createPublicFixture('delete_queued');
    publicChangedVersion.state.onConfig = async () => {
      const row = assets.get(publicChangedVersion.state.asset.id);
      row.updatedAt = new Date(row.updatedAt.getTime() + 1);
    };
    await publicChangedVersion.application.cleanup.cleanupPendingFileAssetDeletes(tenantId);
    assert.deepEqual(publicChangedVersion.state.requests, []);

    const publicUpload = await createPublicUpload();
    assert.equal((await publicUpload.application.completeUpload(tenantId, publicUpload.grant.sessionId, {})).status, 'active');
    assert.deepEqual(publicUpload.state.requests, ['PUT']);

    const publicUploadStopped = await createPublicUpload();
    publicUploadStopped.state.afterTransaction = async () => {
      if (sessions.get(publicUploadStopped.grant.sessionId).status === 'freeze_pending')
        publicUploadStopped.state.coreEnabled = false;
    };
    await assert.rejects(publicUploadStopped.application.completeUpload(tenantId, publicUploadStopped.grant.sessionId, {}), /Current Core is stopped/u);
    assert.deepEqual(publicUploadStopped.state.requests, []);
    assert.equal(sessions.get(publicUploadStopped.grant.sessionId).status, 'freeze_pending');

    const publicUploadLost = await createPublicUpload();
    publicUploadLost.state.losePutReply = true;
    await assert.rejects(publicUploadLost.application.completeUpload(tenantId, publicUploadLost.grant.sessionId, {}), /acknowledgement lost/u);
    const publicOriginalFrozenKey = assets.get(publicUploadLost.grant.fileAssetId).storageKey;
    publicUploadLost.state.losePutReply = false;
    assert.equal((await publicUploadLost.application.completeUpload(tenantId, publicUploadLost.grant.sessionId, {})).status, 'active');
    assert.deepEqual(publicUploadLost.state.requests, ['PUT']);
    assert.equal(assets.get(publicUploadLost.grant.fileAssetId).storageKey, publicOriginalFrozenKey);
    console.log('public file application: dispatch-time Core/config/location/version, one-shot PUT and original recovery passed');

    const publicReceipt = await createPublicUpload();
    const replay = await publicReceipt.application.createUploadSession(tenantId, publicReceipt.request);
    assert.equal(replay.expiresAt, publicReceipt.grant.expiresAt);
    assert.equal(replay.uploadUrl, publicReceipt.grant.uploadUrl);
    publicReceipt.state.onConfig = async () => {
      const session = sessions.get(publicReceipt.grant.sessionId);
      session.expiresAt = new Date(0);
      session.updatedAt = new Date(session.updatedAt.getTime() + 1);
    };
    await assert.rejects(publicReceipt.application.createUploadSession(tenantId, publicReceipt.request), /原上传会话在续签期间已变化/u);
    assert.deepEqual(publicReceipt.state.requests, []);

    const { assertOriginalFileUploadSnapshot } = require('../packages/platform-server/dist/modules/files');
    const observed = { session: structuredClone(sessions.get(publicReceipt.grant.sessionId)) };
    await assert.rejects(assertOriginalFileUploadSnapshot(structuredClone(observed),
      async () => structuredClone(observed),
      async () => { observed.session.updatedAt = new Date(observed.session.updatedAt.getTime() + 1); },
      () => Error('原上传观察版本已变化')), /原上传观察版本已变化/u);
    console.log('file upload receipt/observation: original expiry and Date versions are rechecked before return');
  } finally {
    prisma.$transaction = saved.transaction; runtime.deleteObject = saved.deleteObject; runtime.objectRequest = saved.objectRequest;
    fileConfig = saved.fileConfig; beforeConfig = saved.beforeConfig; duringAudit = saved.duringAudit;
    orders[0].workspaceId = saved.workspace; assets.clear(); sessions.clear();
  }
}

/** 原宿主创建入口续签知识上传，使用真实签名器及明确的知识授权和存储夹具。 */
async function knowledgeUploadRenewalBoundaries() {
  const { requestFingerprint } = require("@rental-os/platform-contracts/request-fingerprint");
  const savedAssets = [...assets];
  const savedSessions = [...sessions];
  const owner = {
    businessType: "ai_knowledge_document", businessId: "knowledge-renewal", uploadScene: "ai-knowledge",
    actorUserId: "knowledge-user", workspaceId
  };
  const request = {
    businessModule: "ai-native", businessType: owner.businessType, businessId: owner.businessId,
    uploadScene: owner.uploadScene, fileName: "knowledge.pdf", mimeType: "application/pdf",
    sizeBytes: 1024, idempotencyKey: "knowledge-original-renewal"
  };
  let config;
  let signatures = 0;
  let configurationReads = 0;
  let authorized = true;
  let duringSigning = () => {};
  let afterConfigurationRead = () => {};
  const knowledge = new FileStorageRuntimeService(prisma, {
    runtimeConfig: async () => {
      configurationReads += 1;
      afterConfigurationRead(configurationReads);
      return structuredClone(config);
    },
    assertEnabledInTransaction: integrations.assertEnabledInTransaction
  }, undefined, undefined, {
    authorizeUpload: async (currentTenant, input, currentOwner) => {
      assert.equal(currentTenant, tenantId);
      assert.equal(input.idempotencyKey, request.idempotencyKey);
      assert.equal(currentOwner.actorUserId, owner.actorUserId);
      assert.equal(currentOwner.workspaceId, owner.workspaceId);
      if (!authorized) throw new Error("知识上传授权已变化");
    }
  }, access);
  const originalPresign = knowledge.presign.bind(knowledge);
  knowledge.presign = (...args) => {
    const signed = originalPresign(...args);
    signatures += 1;
    duringSigning();
    return signed;
  };
  function fixture() {
    assets.clear();
    sessions.clear();
    signatures = 0;
    configurationReads = 0;
    authorized = true;
    duringSigning = () => {};
    afterConfigurationRead = () => {};
    config = {
      id: "knowledge-original-config", capability: "file", provider: "s3_compatible",
      settings: { endpoint: "https://storage.example.invalid", bucket: "files", region: "us-east-1" },
      credentials: { accessKeyId: "offline", secretAccessKey: "offline-only" },
      revision: { updatedAt: new Date(1) }
    };
    const asset = {
      ...assetRow("knowledge-original-file"), businessModule: request.businessModule,
      businessType: request.businessType, businessId: request.businessId, uploadScene: request.uploadScene,
      fileName: request.fileName, storageProvider: config.provider, uploadedBy: owner.actorUserId,
      metadata: { workspaceId, knowledgeUploadVersion: 1, fileUploadVersion: 2,
        uploadConfigHash: requestFingerprint({ id: config.id, provider: config.provider,
          settings: config.settings, credentials: config.credentials }) }
    };
    const session = {
      id: "knowledge-original-session", tenantId, fileAssetId: asset.id, idempotencyKey: request.idempotencyKey,
      provider: config.provider, storageKey: asset.storageKey, status: "pending_upload",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), createdAt: new Date(), updatedAt: new Date()
    };
    assets.set(asset.id, asset); sessions.set(session.id, session);
    return { asset, session };
  }
  try {
    const original = fixture();
    const grant = await knowledge.createUploadSession(tenantId, request, owner);
    assert.equal(grant.sessionId, original.session.id);
    assert.equal(grant.fileAssetId, original.asset.id);
    assert.equal(grant.expiresAt, original.session.expiresAt.toISOString());
    assert.equal(signatures, 1);
    assert.ok(grant.uploadUrl);

    const changes = [
      state => { state.session.expiresAt = new Date(0); },
      state => { state.session.updatedAt = new Date(state.session.updatedAt.getTime() + 1); },
      state => { state.asset.updatedAt = new Date(state.asset.updatedAt.getTime() + 1); },
      () => { config.revision.updatedAt = new Date(2); }
    ];
    for (const change of changes) {
      const state = fixture();
      duringSigning = () => change(state);
      await assert.rejects(knowledge.createUploadSession(tenantId, request, owner), /知识原上传在签发期间已变化/u);
      assert.equal(signatures, 1);
      assert.equal(assets.size, 1);
      assert.equal(sessions.size, 1);
    }
    fixture();
    afterConfigurationRead = calls => {
      if (calls === 2) authorized = false;
    };
    await assert.rejects(knowledge.createUploadSession(tenantId, request, owner), /知识上传授权已变化/u);
    assert.equal(signatures, 1);
  } finally {
    assets.clear();
    savedAssets.forEach(([id, row]) => assets.set(id, row));
    sessions.clear();
    savedSessions.forEach(([id, row]) => sessions.set(id, row));
  }
  console.log("知识文件原键续签在返回前复验日期版本及读取等待后的当前授权");
}

/** The real public cleanup and presigner, with only transactional storage and
 * object transport replaced. Moving the clock never edits a persisted claim. */
async function expiredCleanupBoundaries() {
  const { FileStorageCleanup, FileStoragePrimitives } = require('@rental-os/platform-server/files');
  const { requestFingerprint } = require('@rental-os/platform-contracts/request-fingerprint');
  const { fileStorageLocationHash } = require('@rental-os/platform-contracts/file-content-binding');
  const NativeDate = Date;
  let time = NativeDate.now();
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [time])); return new NativeDate(this.getTime()); }
    static now() { return time; }
    static [Symbol.hasInstance](value) { return value instanceof NativeDate; }
  };
  const advance = () => { time += 11 * 60 * 1000; };
  function fixture() {
    const config = { id: 'cleanup-original-config', capability: 'file', provider: 's3_compatible',
      settings: { endpoint: 'https://storage.example.invalid', bucket: 'files', region: 'us-east-1' },
      credentials: { accessKeyId: 'offline', secretAccessKey: 'offline-only' },
      revision: { updatedAt: new Date(time - 10000) } };
    const asset = { ...assetRow('expired-original'), storageProvider: config.provider,
      storageKey: `tenant-files/${tenantId}/expired-original/blob`, metadata: { fileUploadVersion: 2,
        storageLocationHash: fileStorageLocationHash(config), uploadConfigHash: requestFingerprint({
          id: config.id, provider: config.provider, settings: config.settings, credentials: config.credentials }) } };
    const session = { id: 'expired-original-session', tenantId, fileAssetId: asset.id,
      provider: config.provider, storageKey: asset.storageKey, status: 'pending_upload', idempotencyKey: 'expired-original-key',
      expiresAt: new Date(time - 1000), completedAt: null, failureReason: null, cleanupAttempts: 0,
      cleanupError: null, lastCleanupAt: null, createdAt: new Date(time - 16000), updatedAt: new Date(time - 10000) };
    const state = { asset, session, config, depth: 0, transactions: 0, requests: [], audits: [], exists: true, trace: [] };
    const matchSession = where => {
      const { fileAsset, ...scalar } = where;
      return matches(state.session, scalar) && (!fileAsset || matches(state.asset, fileAsset.is));
    };
    const store = {
      fileAsset: {
        findFirst: async ({ where }) => matches(state.asset, where) ? structuredClone(state.asset) : null,
        findMany: async ({ where }) => matches(state.asset, where) ? [structuredClone(state.asset)] : [],
        updateMany: async ({ where, data }) => {
          assert.equal(state.depth, 1, 'asset CAS belongs to original host transaction');
          state.trace.push('asset');
          if (!matches(state.asset, where)) return { count: 0 };
          if (state.failAssetWrite) throw Error('private asset storage failure');
          Object.assign(state.asset, structuredClone(data)); return { count: 1 };
        }
      },
      fileUploadSession: {
        findMany: async ({ where }) => matchSession(where) ? [structuredClone(state.session)] : [],
        update: async () => { throw Error('unconditional session receipt forbidden'); },
        updateMany: async ({ where, data }) => {
          assert.equal(state.depth, 1, 'session CAS belongs to original host transaction');
          state.trace.push('session');
          if (!matchSession(where)) return { count: 0 };
          Object.assign(state.session, structuredClone(data), { cleanupAttempts:
            state.session.cleanupAttempts + (data.cleanupAttempts?.increment ?? 0) });
          return { count: 1 };
        }
      }
    };
    let queue = Promise.resolve();
    const transaction = async work => {
      const previous = queue; let release;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      const number = ++state.transactions;
      try { await state.beforeTransaction?.(number); }
      catch (error) { release(); throw error; }
      const before = structuredClone({ asset: state.asset, session: state.session });
      let result;
      state.depth++;
      try { result = await work(store); }
      catch (error) { state.asset = before.asset; state.session = before.session; throw error; }
      finally { state.depth--; release(); }
      // This failure is AFTER persistence, outside the rollback catch.
      await state.afterCommit?.(number);
      return result;
    };
    const bytes = new FileStoragePrimitives();
    bytes.objectRequest = async (url, init) => {
      assert.equal(state.depth, 0, 'object IO remains outside the transaction');
      const key = decodeURIComponent(new URL(url).pathname).replace(/^\//u, '');
      state.requests.push({ method: init.method, key });
      assert.equal(key, `${asset.storageKey}.pending-upload`, 'only the original pending key');
      if (init.method === 'DELETE') {
        assert.equal(state.session.status, 'cleanup_in_progress');
        assert(state.session.cleanupError, 'uncertainty must be durable before DELETE');
        if (state.deleteFalse) return new Response(null, { status: 503 });
        state.exists = false;
        await state.afterDelete?.();
        if (state.deleteLost) throw Error('private-provider-error-with-credentials');
        return new Response(null, { status: 204 });
      }
      assert.equal(init.method, 'HEAD');
      if (state.headLost) throw Error('private HEAD failure');
      return new Response(null, { status: state.exists ? 200 : 404 });
    };
    const cleanup = new FileStorageCleanup({ store, transaction, excludedUploadScene: 'reserved-scene',
      runtimeConfig: async (t, p) => { assert.equal(t, tenantId); assert.equal(p, config.provider);
        await state.beforeConfig?.(); return structuredClone(state.config); },
      deleteObject: bytes.deleteObject.bind(bytes), presign: bytes.presign.bind(bytes), objectRequest: bytes.objectRequest,
      recordAudit: async input => { state.audits.push(structuredClone(input)); } });
    return { state, run: () => cleanup.cleanupExpiredUploadSessions(tenantId) };
  }
  try {
    {
      const f = fixture(), result = await f.run();
      assert.deepEqual(result, { scanned: 1, invalidated: 1, deletedObjects: 1, cleanupPending: 0, sessionIds: ['expired-original-session'] });
      assert.equal(f.state.session.status, 'failed'); assert.equal(f.state.asset.status, 'failed');
      assert.equal(f.state.session.cleanupError, null);
      assert.deepEqual(f.state.trace, ['session', 'asset', 'session', 'asset', 'session', 'asset']);
      await f.run(); assert.deepEqual(f.state.requests.map(row => row.method), ['DELETE']);
      const concurrent = fixture();
      await Promise.all([concurrent.run(), concurrent.run()]);
      assert.deepEqual(concurrent.state.requests.map(row => row.method), ['DELETE']);
      assert.equal(concurrent.state.session.cleanupError, null);
      console.log('expired cleanup: original one-shot DELETE and concurrent single claim passed');
    }
    {
      for (const acknowledgement of [1, 2]) {
        const f = fixture();
        f.state.afterCommit = number => { if (number === acknowledgement) throw Error('COMMIT acknowledgement lost'); };
        assert.equal((await f.run()).cleanupPending, 1);
        assert.equal(f.state.requests.length, 0);
        assert.equal(f.state.session.status, 'cleanup_in_progress');
        f.state.afterCommit = undefined; advance();
        await f.run(); assert.deepEqual(f.state.requests.map(row => row.method), ['HEAD']);
        assert(f.state.session.cleanupError, 'HEAD 200 cannot certify deletion or authorize dispatch');
        f.state.exists = false; await f.run();
        assert.deepEqual(f.state.requests.map(row => row.method), ['HEAD', 'HEAD']);
        assert.equal(f.state.session.cleanupError, null);
      }
      console.log('expired cleanup: claim/dispatch-CAS lost COMMIT stays HEAD-only after TTL');
    }
    {
      for (const fault of ['deleteLost', 'deleteFalse', 'receiptLost']) {
        const f = fixture();
        if (fault === 'receiptLost') f.state.afterCommit = number => { if (number === 3) throw Error('receipt COMMIT lost'); };
        else f.state[fault] = true;
        assert.equal((await f.run()).cleanupPending, 1);
        assert(!JSON.stringify([f.state.session, f.state.audits]).includes('private-provider'));
        f.state.afterCommit = undefined; advance();
        await f.run();
        assert.equal(f.state.requests.filter(row => row.method === 'DELETE').length, 1);
        if (fault === 'receiptLost') assert.equal(f.state.requests.length, 1, 'already recorded receipt is read without transport');
        else assert.equal(f.state.requests[1].method, 'HEAD');
        if (fault === 'deleteFalse') {
          assert(f.state.session.cleanupError); f.state.exists = false; await f.run();
        }
        assert.equal(f.state.session.cleanupError, null);
      }
      for (const status of ['failed', 'cleanup_in_progress']) {
        const f = fixture();
        Object.assign(f.state.session, { status, cleanupError: 'arbitrary old provider failure',
          cleanupAttempts: 3, lastCleanupAt: new Date(time - 11 * 60 * 1000) });
        f.state.asset.status = status === 'failed' ? 'failed' : 'pending_upload';
        f.state.headLost = true; await f.run(); f.state.headLost = false; advance();
        await f.run(); f.state.exists = false; await f.run();
        assert(f.state.requests.every(row => row.method === 'HEAD'));
        assert.equal(f.state.session.cleanupError, null);
      }
      console.log('expired cleanup: DELETE/Boolean unknown, lost result receipt and legacy errors never resend');
    }
    {
      for (const change of [s => { s.config.settings.bucket = 'another-bucket'; },
        s => { s.config.id = 'another-config'; }, s => { s.config.credentials.secretAccessKey = 'rotated'; },
        s => { s.config.provider = 'aliyun_oss'; },
        s => { s.asset.storageProvider = 'aliyun_oss'; }, s => { s.asset.storageKey += '-changed'; },
        s => { s.asset.metadata = { uploadMode: 'provider' }; }, s => { s.session.completedAt = new Date(); }]) {
        const f = fixture(); change(f.state);
        const before = structuredClone({ asset: f.state.asset, session: f.state.session });
        assert.equal((await f.run()).cleanupPending, 1); assert.equal(f.state.requests.length, 0);
        assert.deepEqual({ asset: f.state.asset, session: f.state.session }, before);
      }
      const missing = fixture(); missing.state.config = undefined;
      assert.equal((await missing.run()).cleanupPending, 1); assert.equal(missing.state.transactions, 0);
      for (const phase of ['claim', 'receipt']) {
        for (const field of ['asset', 'session']) {
          const f = fixture(); let expected;
          const change = () => {
            if (field === 'asset') { f.state.asset.businessId = 'another-owner'; f.state.asset.updatedAt = new Date(time + 5); }
            else { f.state.session.idempotencyKey = 'another-operation'; f.state.session.updatedAt = new Date(time + 5); }
            expected = structuredClone({ asset: f.state.asset, session: f.state.session });
          };
          if (phase === 'claim') f.state.beforeTransaction = number => { if (number === 1) change(); };
          else f.state.afterDelete = change;
          assert.equal((await f.run()).cleanupPending, 1);
          assert.deepEqual({ asset: f.state.asset, session: f.state.session }, expected, 'CAS rollback never overwrites another writer');
          assert.equal(f.state.requests.length, phase === 'claim' ? 0 : 1);
          f.state.beforeTransaction = undefined; f.state.afterDelete = undefined;
          if (phase === 'receipt') { advance(); await f.run(); assert.equal(f.state.requests.length, 1, 'changed saved digest cannot select another target'); }
        }
      }
      const changedConfig = fixture(); changedConfig.state.deleteLost = true; await changedConfig.run();
      changedConfig.state.config.revision.updatedAt = new Date(time + 1); advance();
      assert.equal((await changedConfig.run()).cleanupPending, 1); assert.equal(changedConfig.state.requests.length, 1);
      const duringConfig = fixture(); let configReads = 0;
      duringConfig.state.beforeConfig = () => { if (++configReads === 2) duringConfig.state.config.settings.bucket = 'changed-at-dispatch'; };
      assert.equal((await duringConfig.run()).cleanupPending, 1); assert.equal(duringConfig.state.requests.length, 0);
      console.log('expired cleanup: exact configuration, provider, asset/session revisions and receipt CAS passed');
    }
    {
      const f = fixture(), before = structuredClone({ asset: f.state.asset, session: f.state.session });
      f.state.failAssetWrite = true; assert.equal((await f.run()).cleanupPending, 1);
      assert.deepEqual({ asset: f.state.asset, session: f.state.session }, before);
      assert.equal(f.state.requests.length, 0, 'session claim and asset failure roll back together');
      const denied = fixture(); denied.state.beforeTransaction = () => { throw Error('host authority revoked'); };
      assert.equal((await denied.run()).cleanupPending, 1); assert.equal(denied.state.requests.length, 0);
      assert.equal(denied.state.session.cleanupAttempts, 0, 'host transaction participant is not bypassed');
      const local = fixture(); local.state.asset.storageProvider = local.state.session.provider = 'local_mock';
      assert.equal((await local.run()).deletedObjects, 1); assert.equal(local.state.requests.length, 0);
      for (const reserved of ['reserved-scene', 'freeze_pending', 'completed']) {
        const excluded = fixture();
        if (reserved === 'reserved-scene') excluded.state.asset.uploadScene = reserved;
        else excluded.state.session.status = reserved;
        const snapshot = structuredClone({ asset: excluded.state.asset, session: excluded.state.session });
        await excluded.run(); assert.equal(excluded.state.transactions, 0); assert.equal(excluded.state.requests.length, 0);
        assert.deepEqual({ asset: excluded.state.asset, session: excluded.state.session }, snapshot);
      }
      console.log('expired cleanup: atomic rollback, local_mock and reserved/frozen/completed isolation passed');
    }
  } finally { globalThis.Date = NativeDate; }
}

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
    completedAt: null, failureReason: null, lastCleanupAt: null, createdAt: new Date(), updatedAt: new Date(),
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
    completedAt: null, failureReason: null, lastCleanupAt: null, createdAt: new Date(), updatedAt: new Date(),
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
  await assert.rejects(() => runtime.downloadUrl(tenantId, qualificationSession.fileAssetId), /敏感资料审计失败，未返回完整信息/);
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
    $queryRaw: async sql => { if (sql.sql.includes("FROM Tenant")) return prisma.$queryRaw(sql);
      const id = sql.values[1]; const row = assets.get(id);
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

    const expiryChanged = await create('immutable-expiry-changed');
    const expiryKey = decodeURIComponent(new URL(expiryChanged.uploadUrl).pathname).replace(/^\//, '');
    const expiryStorageKey = assets.get(expiryChanged.fileAssetId).storageKey;
    const expiryVersion = sessions.get(expiryChanged.sessionId).updatedAt.getTime();
    const putsBeforeExpiry = requests.filter(row => row.method === 'PUT').length;
    objectBytes.set(expiryKey, Buffer.from('HHHH'));
    afterRead = key => {
      if (key === expiryKey) sessions.get(expiryChanged.sessionId).expiresAt = new Date(0);
    };
    try {
      await assert.rejects(() => runtime.completeUpload(tenantId, expiryChanged.sessionId, {}, owner), /原上传会话在内容读取期间已变化/u);
    } finally {
      afterRead = undefined;
    }
    assert.equal(requests.filter(row => row.method === 'PUT').length, putsBeforeExpiry);
    assert.equal(sessions.get(expiryChanged.sessionId).status, 'pending_upload');
    assert.equal(sessions.get(expiryChanged.sessionId).updatedAt.getTime(), expiryVersion);
    assert.equal(assets.get(expiryChanged.fileAssetId).storageKey, expiryStorageKey);
    console.log('文件冻结在原占用和 PUT 前拒绝 Date 快照变化');

    const { freezeFileUploadContent } = require('@rental-os/platform-server/files');
    const controlledSource = await create('immutable-controlled-source-length');
    const controlledAsset = structuredClone(assets.get(controlledSource.fileAssetId));
    const controlledSession = structuredClone(sessions.get(controlledSource.sessionId));
    const controlledAttempts = { transactions: 0, reads: 0, puts: 0 };
    for (const bytes of [Buffer.alloc(0), Buffer.from('AAA'), Buffer.from('AAAAA')]) {
      const contentHash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
      await assert.rejects(() => freezeFileUploadContent({
        tenantId, asset: controlledAsset, session: controlledSession, config: fileConfig
      }, {
        transaction: async () => {
          controlledAttempts.transactions += 1;
          throw Error('invalid controlled bytes must precede the freeze transaction');
        },
        beforeClaim: async () => { throw Error('invalid controlled bytes must precede authorization'); },
        assertConfiguration: async () => { throw Error('invalid controlled bytes must precede configuration locks'); },
        readPendingContent: async () => ({ bytes, contentHash }),
        readContent: async () => {
          controlledAttempts.reads += 1;
          throw Error('invalid controlled bytes must not read an object');
        },
        writeContent: async () => {
          controlledAttempts.puts += 1;
          throw Error('invalid controlled bytes must not dispatch PUT');
        }
      }), /原上传字节与声明大小不一致/);
    }
    assert.deepEqual(controlledAttempts, { transactions: 0, reads: 0, puts: 0 });
    assert.deepEqual(assets.get(controlledSource.fileAssetId), controlledAsset);
    assert.deepEqual(sessions.get(controlledSource.sessionId), controlledSession);
    sessions.delete(controlledSource.sessionId);
    assets.delete(controlledSource.fileAssetId);

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
    prisma.$transaction = async work => {
      const result = await originalTransaction(work);
      const claimResult = result?.result ?? result;
      if (loseClaim && claimResult?.session?.id === claimUnknown.sessionId
        && claimResult.session.cleanupError === 'completed_staging_unknown') {
        loseClaim = false;
        throw Error('cleanup COMMIT acknowledgement lost');
      }
      return result;
    };
    await runtime.cleanupCompletedStagingObjects(tenantId, 100); prisma.$transaction = originalTransaction;
    assert.equal(loseClaim, false, '原清理占用提交后必须实际注入失应答');
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
  assert.equal(png.length,68); let byteRequests=0, frozenWrites=0, frozenReads=0;
  globalThis.fetch=async (url, init) => {
    const objectPath=decodeURIComponent(new URL(url).pathname);
    const stagingPath=decodeURIComponent(new URL(plan.uploadUrl).pathname);
    if (init?.method === 'GET' && objectPath === stagingPath) byteRequests++;
    if (init?.method === 'PUT' && objectPath.startsWith(stagingPath+'.committed/')) frozenWrites++;
    if (init?.method === 'GET' && objectPath.startsWith(stagingPath+'.committed/')) frozenReads++;
    return new Response(png,{ headers:{'content-length':'68','content-type':'image/png'} });
  };
  try {
    await assert.rejects(dedicated.inspectExchangeInspectionUpload(tenantId,plan.assetId,{...owner,workspaceId:otherWorkspaceId},plan.configRowHash,plan.storageLocationHash),/归属/u);
    const proof=await dedicated.inspectExchangeInspectionUpload(tenantId,plan.assetId,owner,plan.configRowHash,plan.storageLocationHash);
    assert.equal(proof.contentHash,require('node:crypto').createHash('sha256').update(png).digest('hex')); assert.equal(proof.width,1); assert.equal(byteRequests,1);
    assert.equal(frozenWrites,1); assert.equal(frozenReads,1);
    const frozenSession=sessions.get(plan.sessionId), frozenAsset=assets.get(plan.assetId);
    assert.equal(frozenSession.status,'freeze_pending');
    assert.equal(frozenAsset.status,'pending_upload');
    assert.equal(frozenSession.storageKey,frozenAsset.storageKey);
    assert.ok(frozenAsset.storageKey.startsWith(plan.storageKey+'.committed/'));
    assert.ok(frozenAsset.storageKey.endsWith('/'+proof.contentHash));
    assert.equal(frozenAsset.checksum,proof.contentHash);
    assert.equal(frozenAsset.metadata.contentHash,proof.contentHash);
    assert.deepEqual(frozenAsset.metadata.exchangeInspectionFrozenEvidence,{
      sourceId:owner.exchangeInspectionSourceId,contentHash:proof.contentHash,sizeBytes:proof.sizeBytes,
      mimeType:proof.mimeType,width:proof.width,height:proof.height
    });
    await assert.rejects(dedicated.completeUpload(tenantId,plan.sessionId,{},owner),/专用/u);
    await assert.rejects(dedicated.deleteFileAsset(tenantId,plan.assetId,owner),/专用/u);
    const sessionBeforeExpiry=structuredClone(frozenSession), assetBeforeExpiry=structuredClone(frozenAsset);
    frozenSession.expiresAt=new Date(0);
    const expiredSessionBeforeCleanup=structuredClone(frozenSession);
    const retained=await dedicated.cleanupExpiredUploadSessions(tenantId); assert.ok(!retained.sessionIds.includes(plan.sessionId));
    assert.equal(frozenSession.status,'freeze_pending'); assert.equal(frozenAsset.status,'pending_upload');
    assert.deepEqual(frozenSession,expiredSessionBeforeCleanup);
    assert.deepEqual(frozenAsset,assetBeforeExpiry);
    frozenSession.expiresAt=plan.expiresAt;
    assert.deepEqual(frozenSession,sessionBeforeExpiry);
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
  await expiredCleanupBoundaries();
  await pendingFileDeleteBoundaries();
  await knowledgeUploadRenewalBoundaries();
  console.log("file storage lifecycle tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
