import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CategoryCapabilityPreparationPatch, CategoryEntityPreparationPatch } from "@rental-os/shared";
import { lockActiveCategoryBinding, type CategoryWriteBinding } from "./category-active-write";
import { assertCategoryAdoptionAllowed } from "./category-governance-policy";
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { readRentalCategoryCode } from "./category-identity";
import { writePreparedCategoryEntities } from "./category-adoption-entity-writer";
import { writePreparedCategoryCapabilities, type CategoryAdoptionCapabilityRuntime } from "./category-adoption-capability-writer";
import type { SubscriptionService } from "../subscription/subscription.service";
import { categoryCommercialCompatibility, categoryCommercialRequirements } from "./category-adoption-commercial";
import { assertCategoryAdoptionConfigurationRowBounds, assertCategoryAdoptionEntityBounds, readFinalCategoryAdoptionCompatibility } from "./category-adoption-final-compatibility";
import type { AuthService } from "../auth/auth.service";
import { lockCategoryAdoptionAccess } from "./category-adoption-access";
import { requireRequestWorkspaceId } from "../../common/request-identity";
import { assertCategoryPreparationBatchSize, categoryPreparationEnvelopeSource } from "./category-preparation-batches";

/** Applies staged entities/configuration and checks the final scoped combination.
 * Caller owns the original-key receipt and commit in this SAME ReadCommitted
 * transaction. This phase owns
 * authenticated principal -> commercial catalog -> identity/policy -> space
 * lock order. Never enter
 * while already holding policy/space locks, or pass a separate preview result.
 * Production/instance readiness is separate from configuration compatibility.
 * Caller owns post-commit cache visibility; this function never initializes it. */
export async function writePreparedCategoryAdoptionPhase(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string; workspaceId: string; actorId: string; targetVersionId: string;
    operation: "upgrade" | "restore"; expected: CategoryWriteBinding;
    expectedPreparationRevision: number;
    expectedTargetPolicyRevision?: number;
    reason?: string;
  },
  capabilityRuntime?: CategoryAdoptionCapabilityRuntime,
  subscriptions?: Pick<SubscriptionService, "lockCategoryCommercialContext" | "readCategoryCommercialContext">,
  auth?: Pick<AuthService, "lockRequestWorkspaceAccess">
) {
  const { tenantId, workspaceId, targetVersionId, expected, operation } = input;
  if (!["upgrade", "restore"].includes(operation) || !input.actorId.trim() || input.actorId.length > 191 ||
      !Number.isSafeInteger(input.expectedPreparationRevision) || input.expectedPreparationRevision < 1 ||
      (input.expectedTargetPolicyRevision !== undefined && (!Number.isSafeInteger(input.expectedTargetPolicyRevision) || input.expectedTargetPolicyRevision < 0)) ||
      !Number.isSafeInteger(expected.adoptionRevision) || expected.adoptionRevision < 0 || expected.adoptionRevision >= 2147483647) {
    throw new BadRequestException("采用操作、操作人或修订号无效");
  }
  if (workspaceId !== requireRequestWorkspaceId()) throw new ConflictException("采用目标与原会话经营空间不一致");
  const access = await lockCategoryAdoptionAccess(tx, { id: input.actorId, tenantId }, auth);
  const identity = await tx.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId }, select: { categoryCode: true } });
  if (!identity) throw new NotFoundException("经营空间不存在");
  if (!subscriptions) throw new ConflictException("未提供可信商业授权执行器，采用未完成");
  // Plan only chooses code-owned lock dependencies. It is NOT authorization.
  // Re-read the complete dependency set after policy/space locks below.
  const plannedTarget = await tx.rentalCategoryVersion.findUnique({ where: { id: targetVersionId } });
  const categoryCode = readRentalCategoryCode(identity.categoryCode);
  const plannedDefinition = resolveRentalCategoryVersionBody(plannedTarget, categoryCode);
  const plannedInstances = await tx.workspaceCapabilityInstance.findMany({ where: { tenantId, workspaceId }, select: { code: true, status: true } });
  // Lock the potential dependency superset before policy/space. Actual grants
  // are checked against the final candidate facts; an unmatched condition does
  // not become an unconditional subscription requirement.
  const potentialRequirements = [...new Set([...plannedDefinition.requiredCapabilities, ...(plannedDefinition.conditionalCapabilities ?? []).map(row => row.code)])];
  const plannedCommercial = categoryCommercialRequirements(plannedDefinition, plannedInstances, undefined, potentialRequirements);
  if (!plannedCommercial.valid) throw new ConflictException(plannedCommercial.blockers.map((row) => row.message).join("；"));
  const commercialContext = await subscriptions.lockCategoryCommercialContext(tenantId, tx, plannedCommercial.featureCodes);
  const policy = await assertCategoryAdoptionAllowed(tx, tenantId, identity.categoryCode, targetVersionId, operation);
  if (input.expectedTargetPolicyRevision !== undefined && policy.versionPolicyRevision !== input.expectedTargetPolicyRevision) {
    throw new ConflictException("目标采用政策修订已变化，请核对原请求和当前政策");
  }
  await lockActiveCategoryBinding(tx, tenantId, workspaceId, expected, categoryCode);
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
  const preparationSource = categoryPreparationEnvelopeSource(envelope);
  if (typeof envelope.reason !== "string" || !envelope.reason.trim() || envelope.reason.length > 512 || !Array.isArray(envelope.items)) {
    throw new ConflictException("预备资料格式或采用原因无效，请重新准备");
  }
  // Legacy single-save data retains its original smaller request limit. A
  // missing format version cannot silently authorize a larger collection.
  if (preparationSource === "batch") assertCategoryPreparationBatchSize(envelope.items);
  if (envelope.capabilityPatches !== undefined && !Array.isArray(envelope.capabilityPatches)) {
    throw new ConflictException("能力预备配置格式无效，采用未完成；预备输入已保留");
  }
  if (!capabilityRuntime) {
    throw new ConflictException("未提供可信能力执行器，采用未完成；预备输入已保留");
  }
  const definition = resolveRentalCategoryVersionBody(target, categoryCode);
  const reason = input.reason ?? envelope.reason.trim();
  if (typeof reason !== "string" || !reason.trim() || reason.length > 512) throw new BadRequestException("必须填写明确采用原因");
  const entityBounds = await assertCategoryAdoptionEntityBounds(tx, tenantId, workspaceId);
  // Component/member collections and configuration row counts are bounded before
  // any entity patch or relationship materialization. The final reader repeats
  // these checks after candidate capability changes in this SAME transaction.
  await assertCategoryAdoptionConfigurationRowBounds(tx, tenantId, workspaceId);
  const entities = await writePreparedCategoryEntities(tx, tenantId, workspaceId, expected, definition, envelope.items);
  const capabilities = Array.isArray(envelope.capabilityPatches) && envelope.capabilityPatches.length
    ? await writePreparedCategoryCapabilities(tx, tenantId, workspaceId, expected, definition, envelope.capabilityPatches as CategoryCapabilityPreparationPatch[], input.actorId, reason.trim(), capabilityRuntime)
    : { changedCapabilityCodes: [] };
  // Inspect the actual candidate facts written in THIS transaction, including
  // concurrent records absent from preparation. A failed check rolls back the
  // entity/configuration writes and their audits; never trust a prior preview.
  const [candidateGroups, candidateAssets] = await Promise.all([
    tx.rentalItemGroup.findMany({ where: { tenantId, workspaceId }, include: { bundleComponents: { select: { componentItemGroupId: true, quantity: true, optional: true, substitutionGroup: true } } } }),
    tx.rentalAsset.findMany({ where: { tenantId, workspaceId } })
  ]);
  const businessCompatibility = await readFinalCategoryAdoptionCompatibility(tx, tenantId, workspaceId, definition,
    { groups: candidateGroups, assets: candidateAssets }, capabilityRuntime, new Date());
  if (!businessCompatibility.complete || !businessCompatibility.valid) throw new ConflictException([...new Set(businessCompatibility.blockers.map((row) => row.message))].join("；") || "最终配置检查未完成");
  if (businessCompatibility.coverage.entityCount !== entityBounds.entityCount) throw new ConflictException("最终型号/资产范围在采用期间已变化，请核对写入入口");
  const finalInstances = await tx.workspaceCapabilityInstance.findMany({ where: { tenantId, workspaceId }, select: { code: true, status: true } });
  const currentCommercial = categoryCommercialRequirements(definition, finalInstances, undefined, businessCompatibility.requiredCapabilityCodes);
  if (!currentCommercial.valid || currentCommercial.featureCodes.some(code => !commercialContext.lockedFeatureCodes.includes(code))) {
    throw new ConflictException("实际能力商业依赖未登记或在等待锁后超出已锁定范围，请重新核对；采用未完成");
  }
  // Time-based entitlements can change while waiting or validating. Read them
  // again for the actual post-patch combination before the binding commit.
  const freshCommercialContext = await subscriptions.readCategoryCommercialContext(tenantId, tx, new Date(), currentCommercial.featureCodes);
  const commercial = categoryCommercialCompatibility(definition.code, currentCommercial, freshCommercialContext);
  if (!commercial.valid) throw new ConflictException(commercial.blockers.map((row) => row.message).join("；"));
  const toRevision = expected.adoptionRevision + 1;
  const changed = await tx.businessWorkspace.updateMany({ where: {
    tenantId, id: workspaceId, status: "ACTIVE", categoryCode: identity.categoryCode,
    categoryVersionId: expected.categoryVersionId, categoryAdoptionRevision: expected.adoptionRevision
  }, data: { categoryVersionId: targetVersionId, categoryAdoptionRevision: toRevision } });
  if (changed.count !== 1) throw new ConflictException("来源品类绑定已变化，采用未完成");
  const audit = await tx.rentalCategoryAdoptionAudit.create({ data: {
    tenantId, workspaceId, fromVersionId: expected.categoryVersionId, toVersionId: targetVersionId,
    fromRevision: expected.adoptionRevision, toRevision, action: operation,
    actorId: input.actorId, reason: reason.trim()
  } });
  // Row locks block committed revocation; time can still pass during business
  // validation. Check the original session/expiry again before returning to the
  // transaction owner. Failure rolls back entities, binding and audit together.
  await access.revalidate();
  // Keep preparation intact on success as well as rollback; never initialize data.
  return { categoryCode: definition.code, targetVersionId, adoptionRevision: toRevision, auditId: audit.id, adoptedAt: audit.createdAt.toISOString(),
    targetPolicyRevision: policy.versionPolicyRevision, entities, capabilities, checkedFeatureCodes: commercial.checkedFeatureCodes, businessCompatibility };
}
