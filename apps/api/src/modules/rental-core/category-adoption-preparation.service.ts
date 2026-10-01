import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { CategoryEntityPreparationPatch, RentalPricingRate, RentalRuleConfig, SaveCategoryPreparationRequest, SystemUserRow, TenantRentalBusinessSettings } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { getRequestDataScope, getRequestLocationIds, requireRequestWorkspaceId } from "../../common/request-identity";
import { assertCategoryAdoptionAllowed, categoryScopeAllows } from "./category-governance-policy";
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { prepareCategoryAdoptionRecords } from "./category-adoption-records";
import { categoryDefinitionDifferences } from "./category-definition-diff";
import { categoryAdoptionBusinessCompatibility } from "./category-adoption-business-compatibility";
import { categoryAdoptionCapabilityReferences } from "./category-adoption-references";
import { categoryAdoptionMarketingReferences } from "./category-adoption-marketing-references";
import { categoryAdoptionPriceReferences } from "./category-adoption-price-references";
import { categoryAdoptionServiceCapacity } from "./category-adoption-service-capacity";
import { WorkspaceCapabilityService } from "./workspace-capability.service";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
import type { RentalCapability, RentalCapabilityConfig, RentalCapabilityLifecycleStatus } from "@rental-os/shared";

export const CATEGORY_ADOPTION_MANAGE = "rental-os:category:adopt";
export function assertCategoryPreparationPermission(user: SystemUserRow) {
  if (user.isSaasAdmin || (!user.permissions.includes("*") && !user.permissions.includes(CATEGORY_ADOPTION_MANAGE))) throw new ForbiddenException("仅获授权的租户人员可准备本空间的品类版本资料");
  if (getRequestDataScope() !== "all" || getRequestLocationIds() !== undefined) throw new ForbiddenException("空间整体版本准备需要当前空间全部资料与地点权限，不能绕过受限数据范围");
}
@Injectable()
export class CategoryAdoptionPreparationService {
  constructor(private readonly prisma: PrismaService, private readonly capabilities: WorkspaceCapabilityService, private readonly hooks: CapabilityHookRuntime) {}
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
    const [target, source, groups, assets, preparation] = await Promise.all([
      tx.rentalCategoryVersion.findUnique({ where: { id: targetId } }),
      tx.rentalCategoryVersion.findUnique({ where: { id: workspace.categoryVersionId } }),
      tx.rentalItemGroup.findMany({ where: { tenantId: user.tenantId, workspaceId }, orderBy: { id: "asc" } }),
      tx.rentalAsset.findMany({ where: { tenantId: user.tenantId, workspaceId }, orderBy: { id: "asc" } }),
      tx.rentalCategoryAdoptionPreparation.findUnique({ where: { workspaceId_targetVersionId: { workspaceId, targetVersionId: targetId } } })
    ]);
    const code = identity.categoryCode.toLowerCase();
    const definition = resolveRentalCategoryVersionBody(target, code);
    const sourceDefinition = resolveRentalCategoryVersionBody(source, code);
    const records = { groups: groups.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })), assets: assets.map((row) => ({ ...row, attributes: row.attributes as Record<string, unknown> })) };
    return { workspace, workspaceId, target: target!, definition, sourceDefinition, preparation, records };
  }
  async preview(user: SystemUserRow, targetId: string, operation: string) {
    assertCategoryPreparationPermission(user);
    return this.prisma.$transaction(async (tx) => {
      const context = await this.context(tx, user, targetId, operation);
      const now = new Date();
      const envelope = context.preparation?.patches as { sourceVersionId?: string; operation?: string; items?: CategoryEntityPreparationPatch[] } | undefined;
      const patches = envelope?.operation === operation ? envelope.items ?? [] : [];
      const stale = Boolean(context.preparation && (context.preparation.sourceRevision !== context.workspace.categoryAdoptionRevision || envelope?.sourceVersionId !== context.workspace.categoryVersionId));
      let validation: { valid: boolean; errors: string[] };
      try {
        if (stale) throw new ConflictException("当前绑定已变化，预备资料必须重新准备");
        prepareCategoryAdoptionRecords(context.definition, context.records.groups, context.records.assets, patches);
        validation = { valid: true, errors: [] };
      } catch (error) { validation = { valid: false, errors: [error instanceof Error ? error.message : "预备资料校验失败"] }; }
      const where = { tenantId: user.tenantId, workspaceId: context.workspaceId };
      const [settings, locations, prices, rules, inspections, capabilityInstances, qualificationTypes, adjustments, pricingPlans, services, pricingGroups, discounts, coupons, capacities, capacityServices] = await Promise.all([
        tx.rentalTenantBusinessSettings.findFirst({ where }),
        tx.rentalFulfillmentLocation.findMany({ where, select: { id: true, type: true, status: true } }),
        tx.rentalPriceVersion.findMany({ where, select: { id: true, effectiveFrom: true, sequence: true, rates: true } }),
        tx.rentalRuleVersion.findMany({ where: { ...where, status: { in: ["published", "pending", "superseded"] }, voidedAt: null }, select: { id: true, effectiveFrom: true, config: true } }),
        tx.rentalInspectionTemplate.findMany({ where, select: { id: true, stage: true, enabled: true, fields: true } }),
        tx.workspaceCapabilityInstance.findMany({ where, select: { code: true, status: true, implementationVersion: true, config: true } }),
        tx.customerMembershipQualificationType.findMany({ where, select: { code: true, categoryCode: true, capabilityCode: true, status: true } }),
        tx.rentalPriceAdjustmentPlan.findMany({ where: { ...where, status: "pending" }, select: { id: true, status: true, finalRates: true } }),
        tx.rentalPricingPlan.findMany({ where: { ...where, status: "enabled" }, select: { id: true, status: true, effectiveTo: true, fulfillmentFees: true, rates: true } }),
        tx.rentalValueAddedService.findMany({ where: { ...where, status: "enabled" }, select: { id: true, status: true, applicableFulfillmentModes: true, applicableItemGroupIds: true, applicableLocationIds: true, mandatoryRule: true } }),
        tx.rentalPricingGroup.findMany({ where, select: { id: true } }),
        tx.rentalDiscountPlan.findMany({ where: { ...where, status: "enabled" }, select: { id: true, status: true, effectiveTo: true, applicableItemGroupIds: true, applicablePricingGroupIds: true } }),
        tx.rentalCouponTemplate.findMany({ where: { ...where, status: { in: ["active", "scheduled"] } }, select: { id: true, status: true, applicableItemGroupIds: true } }),
        tx.rentalServiceCapacity.findMany({ where: { ...where, status: "enabled", windowEnd: { gt: now } }, select: { id: true, serviceId: true, locationId: true, status: true, windowEnd: true } }),
        tx.rentalValueAddedService.findMany({ where, select: { id: true, status: true, requiresCapacity: true } })
      ]);
      const businessCompatibility = categoryAdoptionBusinessCompatibility(context.definition, {
        settings: settings ? settings.settings as unknown as TenantRentalBusinessSettings : null, locations, inspections, qualificationTypes, adjustments, pricingPlans, services,
        prices: prices.map((row) => ({ ...row, value: row.rates as unknown as RentalPricingRate[] })),
        rules: rules.map((row) => ({ ...row, sequence: 0, value: row.config as unknown as RentalRuleConfig }))
      }, now);
      const capabilityCompatibility = this.capabilities.adoptionCompatibility(context.definition, capabilityInstances.map((row) => ({ ...row, code: row.code as RentalCapability, status: row.status as RentalCapabilityLifecycleStatus, config: row.config as RentalCapabilityConfig })), this.hooks.registeredVersions());
      const references = categoryAdoptionCapabilityReferences(context.definition, capabilityInstances, context.records);
      const marketing = categoryAdoptionMarketingReferences({ groups: context.records.groups, pricingGroups, locations, discounts, coupons, services }, now);
      const priceReferences = categoryAdoptionPriceReferences({ groups: context.records.groups, pricingGroups, prices: prices.map((row) => ({ ...row, value: row.rates })), adjustments, plans: pricingPlans }, now);
      const capacityCompatibility = categoryAdoptionServiceCapacity(context.definition, { services: capacityServices, locations, capacities }, now);
      const compatibility = { ...businessCompatibility, valid: businessCompatibility.valid && capabilityCompatibility.valid && references.valid && marketing.valid && priceReferences.valid && capacityCompatibility.valid, blockers: [...businessCompatibility.blockers, ...capabilityCompatibility.blockers, ...references.blockers, ...marketing.blockers, ...priceReferences.blockers, ...capacityCompatibility.blockers], checkedCapabilityCodes: capabilityCompatibility.checkedCapabilityCodes,
        scope: `${businessCompatibility.scope}_capability_instances_references_marketing_entity_references_price_target_references_service_capacity_locations` };
      return { sourceVersionId: context.workspace.categoryVersionId, sourceRevision: context.workspace.categoryAdoptionRevision,
        targetVersionId: targetId, targetVersionLabel: context.target.versionLabel, targetDefinition: context.definition,
        differences: categoryDefinitionDifferences(context.sourceDefinition, context.definition),
        preparation: context.preparation ? { id: context.preparation.id, revision: context.preparation.revision, sourceRevision: context.preparation.sourceRevision, patches: context.preparation.patches } : null,
        validation, validationScope: "entity_attributes_inventory_uniqueness", businessCompatibility: compatibility, stale, previewOnly: true, adoptionImplemented: false,
        entities: { itemGroups: context.records.groups.map((row) => ({ id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(), attributes: Object.fromEntries(Object.entries(row.attributes).filter(([key]) => key !== "__itemGroupMedia")) })),
          assets: context.records.assets.map((row) => ({ id: row.id, assetNo: row.assetNo, updatedAt: row.updatedAt.toISOString(), serialNo: row.serialNo, attributes: row.attributes })) } };
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
      const data = { sourceRevision: body.expectedSourceRevision, patches: JSON.parse(JSON.stringify({ sourceVersionId: body.expectedSourceVersionId, operation: body.operation, reason: body.reason.trim(), items: body.patches })) as Prisma.InputJsonValue };
      const saved = context.preparation ? await tx.rentalCategoryAdoptionPreparation.update({ where: { id: context.preparation.id }, data: { ...data, revision: { increment: 1 } } })
        : await tx.rentalCategoryAdoptionPreparation.create({ data: { ...data, id: randomUUID(), tenantId: user.tenantId, workspaceId: context.workspaceId, targetVersionId: targetId, revision: 1, createdBy: user.id } });
      return { id: saved.id, revision: saved.revision, sourceRevision: saved.sourceRevision, targetVersionId: targetId, preparedOnly: true, adoptionImplemented: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
