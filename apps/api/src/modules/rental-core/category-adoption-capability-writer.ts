import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import type { CategoryCapabilityPreparationPatch, RentalCapability, RentalCapabilityConfig, RentalCapabilityLifecycleStatus, RentalCategoryDefinition, TenantRentalBusinessSettings } from "@rental-os/shared";
import type { WorkspaceCapabilityService } from "./workspace-capability.service";
import { lockActiveCategoryBinding, type CategoryWriteBinding } from "./category-active-write";
import { categoryAdoptionCapabilityReferences } from "./category-adoption-references";
import { workspaceCapabilityRequirements } from "./category-capability-conditions";
import type { CapabilityHookRuntime } from "./capability-hook.runtime";

export interface CategoryAdoptionCapabilityRuntime {
  capabilities: Pick<WorkspaceCapabilityService, "prepareAdoptionConfigs" | "adoptionCompatibility">;
  registeredVersions: string[];
  /** Actual registered runtime required for conditional inspection contracts. */
  hooks?: Pick<CapabilityHookRuntime, "registeredVersions" | "assertCategoryComposition" | "assertInspectionComposition">;
}

/** Internal phase: caller has authorized and checked eligibility and ALL business /
 * commercial dependencies, in this same RC transaction. Entity patches must have
 * been applied first; binding and adoption audit follow in the same transaction.
 * Only explicit absent required/condition-declared candidates can be enabled; never resumes
 * existing instances, switches implementations, or touches old snapshots. */
export async function writePreparedCategoryCapabilities(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  expected: CategoryWriteBinding, target: RentalCategoryDefinition,
  patches: CategoryCapabilityPreparationPatch[], actorId: string, reason: string,
  runtime: CategoryAdoptionCapabilityRuntime
) {
  await lockActiveCategoryBinding(tx, tenantId, workspaceId, expected, target.code);
  const where = { tenantId, workspaceId };
  const [rows, groups, assets] = await Promise.all([
    tx.workspaceCapabilityInstance.findMany({ where, orderBy: { code: "asc" } }),
    tx.rentalItemGroup.findMany({ where, select: { id: true, inventoryMode: true, attributes: true } }),
    tx.rentalAsset.findMany({ where, select: { id: true } })
  ]);
  const instances = rows.map((row) => ({ ...row, code: row.code as RentalCapability, status: row.status as RentalCapabilityLifecycleStatus, config: row.config as RentalCapabilityConfig }));
  const projected = runtime.capabilities.prepareAdoptionConfigs(target, instances, patches, runtime.registeredVersions);
  let requiredCodes = target.requiredCapabilities;
  if (target.conditionalCapabilities?.length) {
    const settings = await tx.rentalTenantBusinessSettings.findFirst({ where });
    requiredCodes = workspaceCapabilityRequirements(target, groups,
      (settings?.settings as unknown as TenantRentalBusinessSettings | undefined)?.fulfillment?.enabledModes).required;
  }
  const compatibility = runtime.capabilities.adoptionCompatibility(target, projected, runtime.registeredVersions, undefined, requiredCodes);
  const references = categoryAdoptionCapabilityReferences(target, projected, { groups, assets });
  if (!compatibility.valid || !references.valid) {
    throw new ConflictException([...compatibility.blockers, ...references.blockers].map((row) => row.message).join("；"));
  }
  const changedCapabilityCodes: string[] = [];
  for (const patch of patches) {
    const current = rows.find((row) => row.code === patch.code);
    const config = projected.find((row) => row.code === patch.code)!.config;
    if (patch.intent === "enable_new") {
      // Projection validated absence, revision zero, required declaration and
      // executable implementation under the same space mutex. No defaults.
      try {
        await tx.workspaceCapabilityInstance.create({ data: { ...where, code: patch.code, status: "enabled",
          revision: 1, implementationVersion: patch.expectedImplementationVersion, configVersion: "v1",
          config: config as Prisma.InputJsonValue, enabledAt: new Date(), updatedBy: actorId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("新能力实例已被创建，请重新准备；采用未完成");
        throw error;
      }
      await tx.workspaceCapabilityAuditEntry.create({ data: { ...where, code: patch.code, action: "enable",
        toStatus: "enabled", implementationVersion: patch.expectedImplementationVersion, configVersion: "v1",
        configSnapshot: config as Prisma.InputJsonValue, reason, operator: actorId, at: new Date() } });
      changedCapabilityCodes.push(patch.code);
      continue;
    }
    if (!current) throw new ConflictException("能力配置来源不存在，采用未完成");
    if (isDeepStrictEqual(current.config, config)) continue;
    const version = /^v([1-9]\d*)$/u.exec(current.configVersion);
    const sequence = version ? Number(version[1]) : NaN;
    if (!Number.isSafeInteger(sequence) || sequence >= 2147483647 || current.revision >= 2147483647) {
      throw new ConflictException("能力配置版本或修订号不可安全递增，采用未完成");
    }
    const configVersion = `v${sequence + 1}`;
    const changed = await tx.workspaceCapabilityInstance.updateMany({ where: {
      ...where, id: current.id, code: patch.code, status: "enabled", revision: patch.expectedRevision,
      implementationVersion: patch.expectedImplementationVersion, configVersion: current.configVersion
    }, data: { config: config as Prisma.InputJsonValue, configVersion, revision: { increment: 1 }, updatedBy: actorId } });
    if (changed.count !== 1) throw new ConflictException("能力配置来源已变化，采用未完成");
    await tx.workspaceCapabilityAuditEntry.create({ data: {
      ...where, code: patch.code, action: "configure", fromStatus: current.status, toStatus: current.status,
      implementationVersion: current.implementationVersion, configVersion, configSnapshot: config as Prisma.InputJsonValue,
      reason, operator: actorId, at: new Date()
    } });
    changedCapabilityCodes.push(patch.code);
  }
  return { changedCapabilityCodes };
}
