import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CategoryCapabilityPreparationPatch, CategoryEntityPreparationPatch } from "@rental-os/shared";
import { lockActiveCategoryBinding, type CategoryWriteBinding } from "./category-active-write";
import { assertCategoryAdoptionAllowed } from "./category-governance-policy";
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { writePreparedCategoryEntities } from "./category-adoption-entity-writer";
import { writePreparedCategoryCapabilities, type CategoryAdoptionCapabilityRuntime } from "./category-adoption-capability-writer";

/** Internal transactional write phase, NOT an adoption endpoint or complete gate.
 * Caller must first authorize the session's whole-space access and validate ALL
 * business/commercial dependencies in this SAME ReadCommitted transaction, using
 * tenant/commercial catalog -> identity/policy -> space lock order. Never call
 * with a separate preview result; acquire the commercial barrier before this phase.
 * No public route invokes this phase while complete compatibility is unavailable.
 * Caller owns commit, idempotency and post-commit cache invalidation. */
export async function writePreparedCategoryAdoptionPhase(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string; workspaceId: string; actorId: string; targetVersionId: string;
    operation: "upgrade" | "restore"; expected: CategoryWriteBinding;
    expectedPreparationRevision: number;
  },
  capabilityRuntime?: CategoryAdoptionCapabilityRuntime
) {
  const { tenantId, workspaceId, targetVersionId, expected, operation } = input;
  if (!["upgrade", "restore"].includes(operation) || !input.actorId.trim() || input.actorId.length > 191 ||
      !Number.isSafeInteger(input.expectedPreparationRevision) || input.expectedPreparationRevision < 1 ||
      !Number.isSafeInteger(expected.adoptionRevision) || expected.adoptionRevision < 0 || expected.adoptionRevision >= 2147483647) {
    throw new BadRequestException("采用操作、操作人或修订号无效");
  }
  const identity = await tx.businessWorkspace.findFirst({ where: { tenantId, id: workspaceId }, select: { categoryCode: true } });
  if (!identity) throw new NotFoundException("经营空间不存在");
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
  if (Array.isArray(envelope.capabilityPatches) && envelope.capabilityPatches.length && !capabilityRuntime) {
    throw new ConflictException("未提供可信能力执行器，采用未完成；预备输入已保留");
  }
  const definition = resolveRentalCategoryVersionBody(target, identity.categoryCode.toLowerCase());
  const entities = await writePreparedCategoryEntities(tx, tenantId, workspaceId, expected, definition, envelope.items);
  const capabilities = Array.isArray(envelope.capabilityPatches) && envelope.capabilityPatches.length
    ? await writePreparedCategoryCapabilities(tx, tenantId, workspaceId, expected, definition, envelope.capabilityPatches as CategoryCapabilityPreparationPatch[], input.actorId, envelope.reason.trim(), capabilityRuntime!)
    : { changedCapabilityCodes: [] };
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
  return { targetVersionId, adoptionRevision: toRevision, auditId: audit.id, entities, capabilities };
}
