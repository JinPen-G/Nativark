import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { CategoryCapabilityPreparationPatch, CategoryEntityPreparationPatch, RentalCapability, RentalCapabilityConfig, RentalCapabilityLifecycleStatus, SaveCategoryPreparationRequest, SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { getRequestDataScope, getRequestLocationIds, requireRequestWorkspaceId } from "../../common/request-identity";
import { assertCategoryAdoptionAllowed, categoryScopeAllows } from "./category-governance-policy";
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { prepareCategoryAdoptionRecords } from "./category-adoption-records";
import { categoryDefinitionDifferences } from "./category-definition-diff";
import { readCategoryAdoptionCompatibility } from "./category-adoption-compatibility-reader";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import { SubscriptionService } from "../subscription/subscription.service";

export const CATEGORY_ADOPTION_MANAGE = "rental-os:category:adopt";
export function assertCategoryPreparationPermission(user: SystemUserRow) {
  if (user.isSaasAdmin || (!user.permissions.includes("*") && !user.permissions.includes(CATEGORY_ADOPTION_MANAGE))) throw new ForbiddenException("仅获授权的租户人员可准备本空间的品类版本资料");
  if (getRequestDataScope() !== "all" || getRequestLocationIds() !== undefined) throw new ForbiddenException("空间整体版本准备需要当前空间全部资料与地点权限，不能绕过受限数据范围");
}
@Injectable()
export class CategoryAdoptionPreparationService {
  constructor(private readonly prisma: PrismaService, private readonly capabilities: WorkspaceCapabilityService, private readonly hooks: CapabilityHookRuntime, private readonly subscriptions: SubscriptionService) {}
  async candidates(user: SystemUserRow, operation: string) {
    assertCategoryPreparationPermission(user);
    if (operation !== "upgrade" && operation !== "restore") throw new BadRequestException("版本操作只能是升级或恢复");
    const workspaceId = requireRequestWorkspaceId();
    const workspace = await this.prisma.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId: user.tenantId, status: "ACTIVE" }, select: { categoryCode: true, categoryVersionId: true, categoryAdoptionRevision: true } });
    if (!workspace?.categoryVersionId) throw new ConflictException("经营空间不可用或尚未绑定版本");
    const versions = await this.prisma.rentalCategoryVersion.findMany({ where: { categoryCode: workspace.categoryCode, status: { in: ["published", "legacy_baseline"] }, id: { not: workspace.categoryVersionId } }, include: { policy: true }, orderBy: [{ publishedAt: "desc" }, { id: "asc" }] });
    // Opening policy governs NEW spaces, not existing-space upgrades/restores.
    // Never return definitions, pilot tenant lists, drafts or governance audits.
    return { categoryCode: workspace.categoryCode.toLowerCase(), sourceVersionId: workspace.categoryVersionId, sourceRevision: workspace.categoryAdoptionRevision, operation,
      versions: versions.filter((row) => row.policy && categoryScopeAllows(row.policy[`${operation}Scope`], row.policy[`${operation}TenantIds`], user.tenantId)).map((row) => {
        try {
          resolveRentalCategoryVersionBody(row, workspace.categoryCode.toLowerCase());
          return { id: row.id, versionLabel: row.versionLabel, definitionExecutable: true };
        } catch (error) {
          return { id: row.id, versionLabel: row.versionLabel, definitionExecutable: false, unavailableReason: error instanceof Error ? error.message : "目标版本无法执行，请联系平台管理员" };
        }
      }) };
  }
  private async context(tx: Prisma.TransactionClient, user: SystemUserRow, targetId: string, operation: string) {
    if (!["upgrade", "restore"].includes(operation)) throw new BadRequestException("版本操作只能是升级或恢复");
    const workspaceId = requireRequestWorkspaceId();
    const identity = await tx.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId: user.tenantId }, select: { categoryCode: true } });
    if (!identity) throw new NotFoundException("经营空间不存在");
    // Same lock order as governance and final adoption: identity/policy, then space.
    await assertCategoryAdoptionAllowed(tx, user.tenantId, identity.categoryCode, targetId, operation as "upgrade" | "restore");
    await tx.$queryRaw(Prisma.sql`SELECT id FROM business_workspaces WHERE tenantId = ${user.tenantId} AND id = ${workspaceId} FOR UPDATE`);
    const workspace = await tx.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId: user.tenantId, status: "ACTIVE" } });
    if (!workspace?.categoryVersionId) throw new ConflictException("经营空间不可用或尚未绑定版本");
    if (workspace.categoryCode !== identity.categoryCode || workspace.categoryVersionId === targetId) throw new ConflictException("目标版本已采用或品类身份已变化");
    const [target, source, groups, assets, preparation, capabilityRows] = await Promise.all([
      tx.rentalCategoryVersion.findUnique({ where: { id: targetId } }),
      tx.rentalCategoryVersion.findUnique({ where: { id: workspace.categoryVersionId } }),
      tx.rentalItemGroup.findMany({ where: { tenantId: user.tenantId, workspaceId }, include: { bundleComponents: { select: { componentItemGroupId: true, quantity: true } } }, orderBy: { id: "asc" } }),
      tx.rentalAsset.findMany({ where: { tenantId: user.tenantId, workspaceId }, orderBy: { id: "asc" } }),
      tx.rentalCategoryAdoptionPreparation.findUnique({ where: { workspaceId_targetVersionId: { workspaceId, targetVersionId: targetId } } }),
      tx.workspaceCapabilityInstance.findMany({ where: { tenantId: user.tenantId, workspaceId }, select: { code: true, status: true, revision: true, implementationVersion: true, configVersion: true, config: true } })
    ]);
    const code = identity.categoryCode.toLowerCase();
    const definition = resolveRentalCategoryVersionBody(target, code);
    const sourceDefinition = resolveRentalCategoryVersionBody(source, code);
    const records = { groups: groups.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })), assets: assets.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })) };
    const capabilityInstances = capabilityRows.map((row) => ({ ...row, code: row.code as RentalCapability, status: row.status as RentalCapabilityLifecycleStatus, config: row.config as RentalCapabilityConfig }));
    return { workspace, workspaceId, target: target!, definition, sourceDefinition, preparation, records, capabilityInstances };
  }
  async preview(user: SystemUserRow, targetId: string, operation: string) {
    assertCategoryPreparationPermission(user);
    return this.prisma.$transaction(async (tx) => {
      const context = await this.context(tx, user, targetId, operation);
      const now = new Date();
      const envelope = context.preparation?.patches as { sourceVersionId?: string; operation?: string; items?: CategoryEntityPreparationPatch[]; capabilityPatches?: CategoryCapabilityPreparationPatch[] } | undefined;
      const patches = envelope?.operation === operation ? envelope.items ?? [] : [];
      const stale = Boolean(context.preparation && (context.preparation.sourceRevision !== context.workspace.categoryAdoptionRevision || envelope?.sourceVersionId !== context.workspace.categoryVersionId));
      let validation: { valid: boolean; errors: string[] };
      let candidateCapabilityPatches: CategoryCapabilityPreparationPatch[] = [];
      let candidateRecords = context.records;
      try {
        if (stale) throw new ConflictException("当前绑定已变化，预备资料必须重新准备");
        const projected = prepareCategoryAdoptionRecords(context.definition, context.records.groups, context.records.assets, patches);
        const groups = new Map(projected.itemGroups.map((row) => [row.id, row]));
        const assets = new Map(projected.assets.map((row) => [row.id, row]));
        candidateRecords = {
          groups: context.records.groups.map((row) => ({ ...row, attributes: groups.get(row.id)!.attributes })),
          assets: context.records.assets.map((row) => ({ ...row, attributes: assets.get(row.id)!.attributes, serialNo: assets.get(row.id)!.serialNo ?? null }))
        };
        if (envelope?.operation === operation && envelope.capabilityPatches !== undefined) {
          this.capabilities.prepareAdoptionConfigs(context.definition, context.capabilityInstances, envelope.capabilityPatches, this.hooks.registeredVersions());
          candidateCapabilityPatches = envelope.capabilityPatches;
        }
        validation = { valid: true, errors: [] };
      } catch (error) { validation = { valid: false, errors: [error instanceof Error ? error.message : "预备资料校验失败"] }; }
      const compatibility = await readCategoryAdoptionCompatibility(tx, user.tenantId, context.workspaceId, context.definition, candidateRecords, this.capabilities, this.hooks, now, candidateCapabilityPatches);
      const commercialContext = await this.subscriptions.readCategoryCommercialContext(user.tenantId, tx, now);
      const businessCompatibility = {
        ...compatibility, valid: compatibility.valid && commercialContext.newBusinessAllowed,
        blockers: [...compatibility.blockers, ...(!commercialContext.newBusinessAllowed ? [{ domain: "commercial", id: "subscription_term", message: "当前订阅已到期，采用新版本前请办理续期；资料准备与既有订单善后不会被自动修改" }] : [])],
        scope: `${compatibility.scope}_subscription_term_snapshot`
      };
      return { sourceVersionId: context.workspace.categoryVersionId, sourceRevision: context.workspace.categoryAdoptionRevision,
        targetVersionId: targetId, targetVersionLabel: context.target.versionLabel, targetDefinition: context.definition,
        differences: categoryDefinitionDifferences(context.sourceDefinition, context.definition),
        preparation: context.preparation ? { id: context.preparation.id, revision: context.preparation.revision, sourceRevision: context.preparation.sourceRevision, patches: context.preparation.patches } : null,
        validation, validationScope: "entity_attributes_inventory_uniqueness", businessCompatibility, commercialContext, stale, previewOnly: true, adoptionImplemented: false,
        entities: { itemGroups: context.records.groups.map((row) => ({ id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(), attributes: Object.fromEntries(Object.entries(row.attributes).filter(([key]) => key !== "__itemGroupMedia")) })),
          assets: context.records.assets.map((row) => ({ id: row.id, assetNo: row.assetNo, updatedAt: row.updatedAt.toISOString(), serialNo: row.serialNo, attributes: row.attributes })),
          capabilities: context.capabilityInstances ?? [] } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async save(user: SystemUserRow, targetId: string, body: SaveCategoryPreparationRequest) {
    assertCategoryPreparationPermission(user);
    if (!body.reason?.trim() || body.reason.length > 512) throw new BadRequestException("必须填写准备原因（最多512字）");
    return this.prisma.$transaction(async (tx) => {
      const context = await this.context(tx, user, targetId, body.operation);
      if (context.workspace.categoryVersionId !== body.expectedSourceVersionId || context.workspace.categoryAdoptionRevision !== body.expectedSourceRevision) throw new ConflictException("来源品类版本已变化，请刷新后重新准备");
      if ((context.preparation?.revision ?? 0) !== body.expectedPreparationRevision) throw new ConflictException("预备资料修订已变化，输入未应用到活动资料");
      prepareCategoryAdoptionRecords(context.definition, context.records.groups, context.records.assets, body.patches);
      const prior = context.preparation?.patches as { sourceVersionId?: string; operation?: string; capabilityPatches?: CategoryCapabilityPreparationPatch[] } | undefined;
      const retained = prior?.sourceVersionId === body.expectedSourceVersionId && prior.operation === body.operation && context.preparation?.sourceRevision === body.expectedSourceRevision ? prior.capabilityPatches : undefined;
      // Old entity-only clients must not silently erase separately prepared config.
      // An explicit [] discards config; omission retains it only for the same source/operation.
      const capabilityPatches = body.capabilityPatches !== undefined ? body.capabilityPatches : retained === undefined ? [] : retained;
      const preparedCapabilities = this.capabilities.prepareAdoptionConfigs(context.definition, context.capabilityInstances, capabilityPatches, this.hooks.registeredVersions());
      // Normalize through the actual implementation schema, not arbitrary JSON merging.
      const normalizedPatches = capabilityPatches.map((patch) => ({ ...patch, config: preparedCapabilities.find((row) => row.code === patch.code)!.config }));
      if (Buffer.byteLength(JSON.stringify(normalizedPatches)) > 256 * 1024) throw new BadRequestException("能力预备配置超过256KB");
      const data = { sourceRevision: body.expectedSourceRevision, patches: JSON.parse(JSON.stringify({ sourceVersionId: body.expectedSourceVersionId, operation: body.operation, reason: body.reason.trim(), items: body.patches, capabilityPatches: normalizedPatches })) as Prisma.InputJsonValue };
      const saved = context.preparation ? await tx.rentalCategoryAdoptionPreparation.update({ where: { id: context.preparation.id }, data: { ...data, revision: { increment: 1 } } })
        : await tx.rentalCategoryAdoptionPreparation.create({ data: { ...data, id: randomUUID(), tenantId: user.tenantId, workspaceId: context.workspaceId, targetVersionId: targetId, revision: 1, createdBy: user.id } });
      return { id: saved.id, revision: saved.revision, sourceRevision: saved.sourceRevision, targetVersionId: targetId, preparedOnly: true, adoptionImplemented: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
