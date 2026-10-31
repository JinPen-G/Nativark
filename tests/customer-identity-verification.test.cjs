const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { CustomerOperationsService } = require("../apps/api/src/modules/platform/customer-operations.service");
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");

function setup() {
  const profiles = new Map([["customer-1", { id: "customer-1", tenantId: "tenant-1", createdInWorkspaceId: "workspace-1", createdByUserId: "reviewer-1", identityVerified: false }]]);
  const verifications = [];
  const files = [{
    id: "identity-file-1", tenantId: "tenant-1", status: "active", businessModule: "membership",
    businessType: "customer", businessId: "customer-1", uploadScene: "identity-verification", mimeType: "image/jpeg"
  }];
  const audits = [];
  const latest = (where) => verifications.filter((row) => row.tenantId === where.tenantId && row.customerId === where.customerId
    && (!where.credentialType || (typeof where.credentialType === "string" ? row.credentialType === where.credentialType : where.credentialType.in.includes(row.credentialType))))
    .sort((a, b) => b.reviewedAt - a.reviewedAt || b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0] ?? null;
  const tx = {
    customerIdentityVerification: {
      async create({ data }) {
        const row = { id: `verification-${verifications.length + 1}`, ...data, createdAt: new Date() };
        verifications.push(row);
        return row;
      },
      async findFirst({ where }) { return latest(where); },
      async findMany({ where }) {
        return verifications.filter((row) => row.tenantId === where.tenantId && row.customerId === where.customerId
          && (!where.credentialType || where.credentialType.in.includes(row.credentialType)))
          .sort((a, b) => b.reviewedAt - a.reviewedAt || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      }
    },
    customerProfile: {
      async updateMany({ where, data }) {
        const profile = profiles.get(where.id);
        if (!profile || profile.tenantId !== where.tenantId) return { count: 0 };
        Object.assign(profile, data);
        return { count: 1 };
      }
    }
  };
  const prisma = {
    customerProfile: {
      async findFirst({ where }) {
        const profile = profiles.get(where.id);
        return profile?.tenantId === where.tenantId
          && (!where.createdInWorkspaceId || profile.createdInWorkspaceId === where.createdInWorkspaceId)
          && (!where.createdByUserId || profile.createdByUserId === where.createdByUserId)
          ? { id: profile.id }
          : null;
      }
    },
    customerIdentityVerification: {
      async findMany({ where }) {
        return verifications.filter((row) => row.tenantId === where.tenantId && row.customerId === where.customerId)
          .sort((a, b) => b.reviewedAt - a.reviewedAt || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      },
      async findFirst({ where }) { return latest(where); }
    },
    rentalOrder: { async findFirst() { return null; } },
    fileAsset: {
      async findMany({ where }) {
        return files.filter((file) => where.id.in.includes(file.id) && file.tenantId === where.tenantId && file.status === where.status
          && file.businessModule === where.businessModule && file.businessType === where.businessType
          && file.businessId === where.businessId && file.uploadScene === where.uploadScene && where.mimeType.in.includes(file.mimeType));
      }
    },
    async $transaction(work) { return work(tx); }
  };
  const customers = {
    async setIdentityVerificationState(tenantId, customerId, identityVerified, transaction) {
      return transaction.customerProfile.updateMany({ where: { tenantId, id: customerId }, data: { identityVerified } });
    }
  };
  const operations = { async recordSensitiveAccess(tenantId, entry) { audits.push({ tenantId, ...entry }); } };
  const service = new CustomerOperationsService(prisma, customers, operations);
  const user = { id: "reviewer-1", displayName: "核验管理员", isSaasAdmin: false, isPlatformAdmin: false,
    permissions: ["rental-os:member:view", "rental-os:member:manage", "rental-os:customer:reveal-sensitive"] };
  return { service, user, profiles, verifications, audits };
}

(async () => {
  const ctx = setup();
  const filesControllerSource = fs.readFileSync(path.join(__dirname, "../apps/api/src/modules/files/files.controller.ts"), "utf8");
  const storageRuntimeSource = fs.readFileSync(path.join(__dirname, "../apps/api/src/modules/integrations/file-storage.runtime.service.ts"), "utf8");
  assert.match(filesControllerSource, /实名凭证必须通过客户专用上传入口/u, "generic uploads cannot bypass customer scope checks");
  assert.match(filesControllerSource, /integrationsService\.listFiles\(query\)/u, "general ledger must use the same business ACL as the dashboard");
  const fileAccessSource = fs.readFileSync(path.join(__dirname, "../apps/api/src/modules/files/file-business-access.service.ts"), "utf8");
  assert.match(fileAccessSource, /\['ai_knowledge_document', 'customer', 'customer_profile', 'membership_review'\]\.includes\(file.businessType\)/u,
    "generic ledger must exclude identity and qualification evidence metadata");
  assert.match(storageRuntimeSource, /当前授权的客户实名核验资料/u, "generic file download URLs cannot expose identity evidence");
  const base = { credentialType: "identity_card", result: "verified", evidenceFileAssetIds: ["identity-file-1"], reason: "人工核验通过" };

  await assert.rejects(() => ctx.service.saveIdentityVerification("tenant-1", "customer-1", { ...base, evidenceFileAssetIds: [] }, ctx.user), /必须关联至少一份/u);
  await assert.rejects(() => ctx.service.saveIdentityVerification("tenant-1", "customer-1", { ...base, evidenceFileAssetIds: ["foreign-file"] }, ctx.user), /不属于该客户/u);

  const verified = await ctx.service.saveIdentityVerification("tenant-1", "customer-1", base, ctx.user);
  assert.equal(verified.result, "verified");
  assert.equal(verified.reviewerUserId, "reviewer-1");
  assert.deepEqual(verified.evidenceFileAssetIds, ["identity-file-1"]);
  assert.equal(ctx.profiles.get("customer-1").identityVerified, true, "only the audited verification path may set the profile fact");

  const rows = await ctx.service.listIdentityVerifications("tenant-1", "customer-1", ctx.user);
  assert.equal(rows.length, 1);
  assert.equal(ctx.audits.length, 1);
  assert.equal(ctx.audits[0].permission, "rental-os:customer:reveal-sensitive");

  const revoked = await ctx.service.saveIdentityVerification("tenant-1", "customer-1", {
    credentialType: "identity_card", result: "revoked", evidenceFileAssetIds: [], reason: "证件已失效"
  }, ctx.user);
  assert.equal(revoked.result, "revoked");
  assert.equal(ctx.profiles.get("customer-1").identityVerified, false);
  await assert.rejects(() => ctx.service.saveIdentityVerification("tenant-1", "customer-1", {
    credentialType: "identity_card", result: "revoked", evidenceFileAssetIds: [], reason: "重复撤销"
  }, ctx.user), /只有当前已通过/u);

  await ctx.service.saveIdentityVerification("tenant-1", "customer-1", {
    credentialType: "identity_card", result: "verified", evidenceFileAssetIds: ["identity-file-1"], reason: "身份证重新核验"
  }, ctx.user);
  await ctx.service.saveIdentityVerification("tenant-1", "customer-1", {
    credentialType: "passport", result: "verified", evidenceFileAssetIds: ["identity-file-1"], reason: "护照核验"
  }, ctx.user);
  await ctx.service.saveIdentityVerification("tenant-1", "customer-1", {
    credentialType: "passport", result: "revoked", evidenceFileAssetIds: [], reason: "护照失效"
  }, ctx.user);
  assert.equal(ctx.profiles.get("customer-1").identityVerified, true, "revoking one credential must preserve another independently verified credential");

  const insufficient = { ...ctx.user, permissions: ["rental-os:customer:reveal-sensitive"] };
  await assert.rejects(() => ctx.service.listIdentityVerifications("tenant-1", "customer-1", insufficient), /会员查看\/管理/u);
  await assert.rejects(() => ctx.service.saveIdentityVerification("tenant-1", "customer-1", base, { ...ctx.user, isSaasAdmin: true }), /无权访问/u);
  await runWithRequestIdentity({ tenantId: "tenant-1", workspaceId: "workspace-other", userId: "reviewer-1", isSaasAdmin: false, dataScope: "own" }, async () => {
    await assert.rejects(() => ctx.service.listIdentityVerifications("tenant-1", "customer-1", ctx.user), /不在当前账号的数据范围内/u);
    await assert.rejects(() => ctx.service.saveIdentityVerification("tenant-1", "customer-1", base, ctx.user), /不在当前账号的数据范围内/u);
  });

  console.log("customer identity verification tests passed: evidence scope, mandatory evidence, immutable reviewer history, atomic profile state, access audit, revoke transition, least privilege");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
