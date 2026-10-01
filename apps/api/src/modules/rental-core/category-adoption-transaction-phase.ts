import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CategoryCapabilityPreparationPatch, CategoryEntityPreparationPatch } from "@rental-os/shared";
import { lockActiveCategoryBinding, type CategoryWriteBinding } from "./category-active-write";
import { assertCategoryAdoptionAllowed } from "./category-governance-policy";
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { writePreparedCategoryEntities } from "./category-adoption-entity-writer";
import { writePreparedCategoryCapabilities, type CategoryAdoptionCapabilityRuntime } from "./category-adoption-capability-writer";
import type { SubscriptionService } from "../subscription/subscription.service";
import { categoryCommercialCompatibility, categoryCommercialRequirements } from "./category-adoption-commercial";
import { readCategoryAdoptionCompatibility } from "./category-adoption-compatibility-reader";

/** Internal transactional write phase, NOT an adoption endpoint or complete gate.
 * Caller must authorize the session's whole-space access and validate ALL
 * business dependencies in this SAME ReadCommitted transaction. This phase owns
 * tenant/commercial catalog -> identity/policy -> space lock order. Never enter
 * while already holding policy/space locks, or pass a separate preview result.
 * No public route invokes this phase while complete compatibility is unavailable.
 * Caller owns commit, idempotency and post-commit cache invalidation. */
export async function writePreparedCategoryAdoptionPhase(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string; workspaceId: string; actorId: string; targetVersionId: string;
    operation: "upgrade" | "restore"; expected: CategoryWriteBinding;
    expectedPreparationRevision: number;
  },
  capabilityRuntime?: CategoryAdoptionCapabilityRuntime,
  subscriptions?: Pick<SubscriptionService, "lockCategoryCommercialContext" | "readCategoryCommercialContext">
) {
  const { tenantId, workspaceId, targetVersionId, expected, operation } = input;
  if (!["upgrade", "restore"].includes(operation) || !input.actorId.trim() || input.actorId.length > 191 ||
      !Number.isSafeInteger(input.expectedPreparationRevision) || input.expectedPreparationRevision < 1 ||
      !Number.isSafeInteger(expected.adoptionRevision) || expected.adoptionRevision < 0 || expected.adoptionRevision >= 2147483647) {
    throw new BadRequestException("采用操作、操作人或修订号无效");
  }
  const identity = await tx.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId }, select: { categoryCode: true } });
  if (!identity) throw new NotFoundException("经营空间不存在");
  if (!subscriptions) throw new ConflictException("未提供可信商业授权执行器，采用未完成");
  // Plan only chooses code-owned lock dependencies. It is NOT authorization.
  // Re-read the complete dependency set after policy/space locks below.
  const plannedTarget = await tx.rentalCategoryVersion.findUnique({ where: { id: targetVersionId } });
  const plannedDefinition = resolveRentalCategoryVersionBody(plannedTarget, identity.categoryCode.toLowerCase());
  const plannedInstances = await tx.workspaceCapabilityInstance.findMany({ where: { tenantId, workspaceId }, select: { code: true, status: true } });
  const plannedCommercial = categoryCommercialRequirements(plannedDefinition, plannedInstances);
  if (!plannedCommercial.valid) throw new ConflictException(plannedCommercial.blockers.map((row) => row.message).join("；"));
  const commercialContext = await subscriptions.lockCategoryCommercialContext(tenantId, tx, plannedCommercial.featureCodes);
  await assertCategoryAdoptionAllowed(tx, tenantId, identity.categoryCode, targetVersionId, operation);
  await lockActiveCategoryBinding(tx, tenantId, workspaceId, expected, identity.categoryCode.toLowerCase());
  if (targetVersionId === expected.categoryVersionId) throw new ConflictException("目标版本已经采用");
  const [target, preparation] = await Promise.all([
    tx.rentalCategoryVersion.findUnique({ where: { id: targetVersionId } }),
    tx.rentalCategoryAdoptionPreparation.findFirst({ where: { tenantId, workspaceId, targetVersionId } })
  ]);
  const envelope = preparation?.patches as { sourceVersionId?: string; operation?: string; reason?: string; items?: CategoryEntityPreparationPatch[]; capabilityPatches?: unknown } | undefined;
  if (!preparation || preparation.revision !== input.expectedPreparationRevision || preparation.sourceRevision !== expected.adoptionRevision ||
      envelope?.sourceVersionId !== expected.categoryVersionId || envelope.operation !== operation) {
    throw new ConflictException("预备资料或来源版本修订已变化，请重新准备");
  }
  if (typeof envelope.reason !== "string" || !envelope.reason.trim() || envelope.reason.length > 512 || !Array.isArray(envelope.items)) {
    throw new ConflictException("预备资料格式或采用原因无效，请重新准备");
  }
  if (envelope.capabilityPatches !== undefined && !Array.isArray(envelope.capabilityPatches)) {
    throw new ConflictException("能力预备配置格式无效，采用未完成；预备输入已保留");
  }
  if (!capabilityRuntime) {
    throw new ConflictException("未提供可信能力执行器，采用未完成；预备输入已保留");
  }
  const definition = resolveRentalCategoryVersionBody(target, identity.categoryCode.toLowerCase());
  const currentInstances = await tx.workspaceCapabilityInstance.findMany({ where: { tenantId, workspaceId }, select: { code: true, status: true } });
  const currentCommercial = categoryCommercialRequirements(definition, currentInstances);
  if (JSON.stringify(currentCommercial.featureCodes) !== JSON.stringify(commercialContext.lockedFeatureCodes)) {
    throw new ConflictException("能力商业依赖在等待锁后已变化，请重新核对；采用未完成");
  }
  // Term/grant time boundaries may pass while waiting for policy/space locks,
  // even though parent/catalog rows remained locked. Do not reuse the earlier
  // timestamp as the authorization time for a later write.
  const freshCommercialContext = await subscriptions.readCategoryCommercialContext(tenantId, tx, new Date(), currentCommercial.featureCodes);
  const commercial = categoryCommercialCompatibility(definition.code, currentCommercial, freshCommercialContext);
  if (!commercial.valid) throw new ConflictException(commercial.blockers.map((row) => row.message).join("；"));
  const entities = await writePreparedCategoryEntities(tx, tenantId, workspaceId, expected, definition, envelope.items);
  const capabilities = Array.isArray(envelope.capabilityPatches) && envelope.capabilityPatches.length
    ? await writePreparedCategoryCapabilities(tx, tenantId, workspaceId, expected, definition, envelope.capabilityPatches as CategoryCapabilityPreparationPatch[], input.actorId, envelope.reason.trim(), capabilityRuntime)
    : { changedCapabilityCodes: [] };
  // Inspect the actual candidate facts written in THIS transaction, including
  // concurrent records absent from preparation. A failed check rolls back the
  // entity/configuration writes and their audits; never trust a prior preview.
  // This reader remains partial: passing it does not open the public adoption
  // route or waive the caller's remaining final-gate responsibilities.
  const [candidateGroups, candidateAssets] = await Promise.all([
    tx.rentalItemGroup.findMany({ where: { tenantId, workspaceId }, include: { bundleComponents: { select: { componentItemGroupId: true, quantity: true } } } }),
    tx.rentalAsset.findMany({ where: { tenantId, workspaceId } })
  ]);
  const businessCompatibility = await readCategoryAdoptionCompatibility(tx, tenantId, workspaceId, definition,
    { groups: candidateGroups, assets: candidateAssets }, capabilityRuntime.capabilities,
    { registeredVersions: () => capabilityRuntime.registeredVersions }, new Date());
  if (!businessCompatibility.valid) throw new ConflictException(businessCompatibility.blockers.map((row) => row.message).join("；"));
  const toRevision = expected.adoptionRevision + 1;
  const changed = await tx.businessWorkspace.updateMany({ where: {
    tenantId, id: workspaceId, status: "ACTIVE", categoryCode: identity.categoryCode,
    categoryVersionId: expected.categoryVersionId, categoryAdoptionRevision: expected.adoptionRevision
  }, data: { categoryVersionId: targetVersionId, categoryAdoptionRevision: toRevision } });
  if (changed.count !== 1) throw new ConflictException("来源品类绑定已变化，采用未完成");
  const audit = await tx.rentalCategoryAdoptionAudit.create({ data: {
    tenantId, workspaceId, fromVersionId: expected.categoryVersionId, toVersionId: targetVersionId,
    fromRevision: expected.adoptionRevision, toRevision, action: operation,
    actorId: input.actorId, reason: envelope.reason.trim()
  } });
  // Keep preparation intact on success as well as rollback; never initialize data.
  return { targetVersionId, adoptionRevision: toRevision, auditId: audit.id, entities, capabilities, checkedFeatureCodes: commercial.checkedFeatureCodes, businessCompatibility };
}
