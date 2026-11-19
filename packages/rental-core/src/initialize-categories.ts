/** 部署人员显式初始化 Rental 内置品类；调用方提供同一事务。
 * 保留原 Seed 的身份、legacy 快照和已发布版本规则；不创建租户/空间/成员，升级不自动执行。 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { RENTAL_CATEGORY_DEFINITIONS } from "./contracts";

export type RentalCategoryInitializationTransaction = Pick<Prisma.TransactionClient,
  "rentalCategoryDefinition" | "rentalCategoryVersion" | "rentalCategoryVersionPolicy">;

/** 该显式部署动作不是 HTTP 授权入口；宿主须先核定迁移、运维权限并包在事务内。 */
export async function initializeRentalCategories(transaction: RentalCategoryInitializationTransaction,
  input: { actorId: string; now: Date }) {
  if (!input.actorId.trim() || input.actorId.length > 191 || !Number.isFinite(input.now.getTime()))
    throw new Error("Rental 品类初始化须提供明确操作者及有效时间");
  const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  const results: Array<{ code: string; builtinVersionId: string; existed: boolean }> = [];
  for (const runtime of RENTAL_CATEGORY_DEFINITIONS) {
    const category = {
      code: runtime.code, name: runtime.name, description: runtime.description,
      supportedInventoryModes: asJson(runtime.supportedInventoryModes),
      defaultCapabilities: asJson(runtime.defaultCapabilities), terminology: asJson(runtime.terminology),
      attributeSchema: asJson(runtime.attributeSchema), businessModel: asJson(runtime.businessModel), version: runtime.version
    };
    const existed = await transaction.rentalCategoryDefinition.findUnique({
      where: { code: category.code }, select: { code: true }
    });
    const stored = await transaction.rentalCategoryDefinition.upsert({ where: { code: category.code }, update: {}, create: category });
    const versionId = `legacy:${stored.code}`;
    await transaction.rentalCategoryVersion.upsert({ where: { id: versionId }, update: {}, create: {
      id: versionId, categoryCode: stored.code, versionLabel: stored.version.slice(0, 64),
      sourceKind: "current_db_snapshot", status: "legacy_baseline",
      definition: asJson({ code: stored.code, name: stored.name, description: stored.description,
        supportedInventoryModes: stored.supportedInventoryModes, defaultCapabilities: stored.defaultCapabilities,
        terminology: stored.terminology, attributeSchema: stored.attributeSchema,
        businessModel: stored.businessModel, version: stored.version }),
      publishedAt: input.now, publishedBy: input.actorId,
      publishReason: "Current DB definition only; not historical order evidence"
    } });
    await transaction.rentalCategoryVersionPolicy.upsert({ where: { versionId }, update: {}, create: { versionId } });
    const digest = createHash("sha256").update(JSON.stringify(runtime)).digest("hex").slice(0, 24);
    const builtinId = `builtin:${runtime.code}:${digest}`;
    const builtin = await transaction.rentalCategoryVersion.upsert({ where: { id: builtinId }, update: {}, create: {
      id: builtinId, categoryCode: stored.code, versionLabel: `builtin-${runtime.version}-${digest}`,
      sourceVersionId: versionId, sourceKind: "builtin_runtime", status: "published",
      definition: asJson(runtime), publishedAt: input.now, publishedBy: input.actorId, publishReason: "内置运行定义首次初始化"
    } });
    if (builtin.categoryCode !== stored.code || builtin.status !== "published"
      || !isDeepStrictEqual(builtin.definition, asJson(runtime)))
      throw new Error(`内置品类版本 ${builtinId} 与运行定义不一致，拒绝覆盖`);
    await transaction.rentalCategoryVersionPolicy.upsert({ where: { versionId: builtinId }, update: {}, create: { versionId: builtinId } });
    // 老库不自动把当前代码当成当年可运行依据；既有推荐、政策与绑定都保持原值。
    await transaction.rentalCategoryDefinition.updateMany({ where: { code: stored.code, recommendedVersionId: null },
      data: { recommendedVersionId: existed ? versionId : builtinId } });
    results.push({ code: stored.code, builtinVersionId: builtinId, existed: !!existed });
  }
  return { categories: results };
}
