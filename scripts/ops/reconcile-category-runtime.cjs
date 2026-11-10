"use strict";

/**
 * CAT-GOV-02: one-time, explicit reconciliation of the four running code
 * definitions with the database's old mutable definition rows. The old rows
 * remain untouched and their migration snapshots remain available as
 * provenance. Only run on a dedicated clone; shared deployment needs a
 * separately authorized release procedure.
 */
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { PrismaClient } = require("@prisma/client");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { resolveDedicatedTarget, redact } = require("./dedicated-env.cjs");

resolveDedicatedTarget(process.env.DATABASE_URL);
const db = new PrismaClient();
const asJson = (value) => JSON.parse(JSON.stringify(value));

void (async () => {
  const result = [];
  try {
    for (const fixed of RENTAL_CATEGORY_DEFINITIONS) {
      const prismaCode = fixed.code;
      const digest = createHash("sha256").update(JSON.stringify(fixed)).digest("hex").slice(0, 24);
      const versionId = `builtin:${fixed.code}:${digest}`;
      const legacyId = `legacy:${fixed.code}`;
      const converted = await db.$transaction(async (tx) => {
        const category = await tx.rentalCategoryDefinition.findUnique({ where: { code: prismaCode } });
        if (!category) throw new Error(`缺少内置品类身份 ${fixed.code}`);
        const existing = await tx.rentalCategoryVersion.findUnique({ where: { id: versionId } });
        if (existing && (existing.categoryCode !== prismaCode ||
            !isDeepStrictEqual(existing.definition, asJson(fixed)))) {
          throw new Error(`内置版本 ${versionId} 内容不匹配，禁止覆盖`);
        }
        if (!existing) {
          await tx.rentalCategoryVersion.create({ data: {
            id: versionId, categoryCode: prismaCode,
            versionLabel: `builtin-${fixed.version}-${digest}`,
            structureVersion: 1, sourceVersionId: legacyId,
            sourceKind: "builtin_runtime", status: "published", revision: 0,
            definition: asJson(fixed), publishedAt: new Date(),
            publishedBy: "system:reconcile", publishReason: "经核对的当前运行代码定义"
          } });
          await tx.rentalCategoryGovernanceAudit.create({ data: {
            categoryCode: prismaCode, versionId, action: "builtin_publish",
            actorId: "system:reconcile", reason: "保存实际运行定义，不覆盖旧数据库定义"
          } });
        }
        await tx.rentalCategoryVersionPolicy.upsert({
          where: { versionId }, update: {}, create: { versionId }
        });
        if (category.recommendedVersionId !== legacyId && category.recommendedVersionId !== versionId) {
          throw new Error(`品类 ${fixed.code} 已选用其他推荐版本，拒绝自动改动`);
        }
        if (category.recommendedVersionId === legacyId) {
          await tx.rentalCategoryDefinition.update({
            where: { code: prismaCode },
            data: { recommendedVersionId: versionId, openingRevision: { increment: 1 } }
          });
          await tx.rentalCategoryGovernanceAudit.create({ data: {
            categoryCode: prismaCode, versionId, action: "recommend_builtin",
            actorId: "system:reconcile", reason: "运行定义与旧数据库行不一致；显式选用可执行版本",
            before: { recommendedVersionId: legacyId }, after: { recommendedVersionId: versionId }
          } });
        }
        const workspaces = await tx.businessWorkspace.findMany({
          where: { categoryCode: prismaCode, categoryVersionId: legacyId },
          select: { id: true, tenantId: true, categoryAdoptionRevision: true }
        });
        for (const workspace of workspaces) {
          const updated = await tx.businessWorkspace.updateMany({
            where: { id: workspace.id, categoryVersionId: legacyId,
              categoryAdoptionRevision: workspace.categoryAdoptionRevision },
            data: { categoryVersionId: versionId, categoryAdoptionRevision: { increment: 1 } }
          });
          if (updated.count !== 1) throw new Error(`空间 ${workspace.id} 绑定已变动`);
          await tx.rentalCategoryAdoptionAudit.create({ data: {
            tenantId: workspace.tenantId, workspaceId: workspace.id,
            fromVersionId: legacyId, toVersionId: versionId,
            fromRevision: workspace.categoryAdoptionRevision,
            toRevision: workspace.categoryAdoptionRevision + 1,
            action: "runtime_reconcile", actorId: "system:reconcile",
            reason: "从旧数据库快照绑定到实际运行定义；不代表历史订单曾采用此版"
          } });
        }
        return { code: fixed.code, versionId, reboundWorkspaces: workspaces.length };
      }, { timeout: 30000 });
      result.push(converted);
    }
    console.log(JSON.stringify({ result: "passed", categories: result }));
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : String(error), [
      new URL(process.env.DATABASE_URL).password
    ]));
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
})();
