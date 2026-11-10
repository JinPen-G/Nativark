import type { Prisma } from "@prisma/client";
import type { CategoryCapabilityPreparationPatch, RentalCategoryDefinition, RentalPricingRate, RentalRuleConfig, TenantRentalBusinessSettings, RentalCapability, RentalCapabilityConfig, RentalCapabilityLifecycleStatus, RentalInspectionTemplate, RentalCategoryCode } from "@rental-os/shared";
import type { WorkspaceCapabilityService } from "./workspace-capability.service";
import type { CapabilityHookRuntime } from "./capability-hook.runtime";
import { categoryAdoptionBusinessCompatibility } from "./category-adoption-business-compatibility";
import { categoryAdoptionCapabilityReferences } from "./category-adoption-references";
import { categoryAdoptionMarketingReferences } from "./category-adoption-marketing-references";
import { categoryAdoptionPriceReferences } from "./category-adoption-price-references";
import { categoryAdoptionServiceCapacity } from "./category-adoption-service-capacity";
import { categoryAdoptionProductGraph, type CategoryAdoptionBundleComponent } from "./category-adoption-product-graph";
import { categoryAdoptionPriceStructure } from "./category-adoption-price-structure";
import { categoryAdoptionSettingsExecutionErrors } from "./category-adoption-settings-execution";
import { categoryAdoptionFulfillmentReferences } from "./category-adoption-fulfillment-references";
import { workspaceCapabilityRequirements } from "./category-capability-conditions";
import { categoryAdoptionInspectionFieldsValid } from "./category-adoption-business-compatibility";
import { projectInspectionTemplatePolicy } from "./rental-inspection-template-snapshot";

/** Shared transaction reader for preparation and the eventual adoption gate.
 * Caller holds the category/policy -> space mutex; records must be freshly read
 * from this same scoped transaction, never supplied by the client or a cache.
 * This is partial compatibility only and must not authorize final adoption. */
export async function readCategoryAdoptionCompatibility(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  target: RentalCategoryDefinition,
  records: {
    groups: Array<{ id: string; status: string; inventoryMode: string; attributes?: unknown; bundleComponents: CategoryAdoptionBundleComponent[] }>;
    assets: Array<{ id: string; itemGroupId: string; locationId: string }>;
  },
  capabilities: Pick<WorkspaceCapabilityService, "prepareAdoptionConfigs" | "adoptionCompatibility">,
  hooks: Pick<CapabilityHookRuntime, "registeredVersions"> & Partial<Pick<CapabilityHookRuntime, "assertCategoryComposition" | "assertInspectionComposition">>, now: Date,
  capabilityPatches: CategoryCapabilityPreparationPatch[] = []
) {
  const where = { tenantId, workspaceId };
  const [settings, locations, prices, rules, inspections, capabilityInstances, qualificationTypes, adjustments, pricingPlans, services, pricingGroups, discounts, coupons, capacities, capacityServices, operators] = await Promise.all([
    tx.rentalTenantBusinessSettings.findFirst({ where }),
    tx.rentalFulfillmentLocation.findMany({ where, select: { id: true, type: true, status: true, operatorId: true, parentLocationId: true, capabilities: true } }),
    tx.rentalPriceVersion.findMany({ where, select: { id: true, effectiveFrom: true, sequence: true, rates: true } }),
    tx.rentalRuleVersion.findMany({ where: { ...where, status: { in: ["published", "pending", "superseded"] }, voidedAt: null }, select: { id: true, effectiveFrom: true, config: true } }),
    tx.rentalInspectionTemplate.findMany({ where, select: { id: true, categoryCode: true, code: true, name: true, version: true, stage: true, enabled: true, fields: true } }),
    tx.workspaceCapabilityInstance.findMany({ where, select: { code: true, status: true, revision: true, implementationVersion: true, config: true } }),
    tx.customerMembershipQualificationType.findMany({ where, select: { code: true, categoryCode: true, capabilityCode: true, status: true } }),
    tx.rentalPriceAdjustmentPlan.findMany({ where: { ...where, status: "pending" }, select: { id: true, status: true, finalRates: true } }),
    tx.rentalPricingPlan.findMany({ where: { ...where, status: "enabled" }, select: { id: true, status: true, effectiveTo: true, fulfillmentFees: true, rates: true } }),
    tx.rentalValueAddedService.findMany({ where: { ...where, status: "enabled" }, select: { id: true, status: true, applicableFulfillmentModes: true, applicableItemGroupIds: true, applicableLocationIds: true, mandatoryRule: true } }),
    tx.rentalPricingGroup.findMany({ where, select: { id: true, status: true, defaultPricingUnit: true, members: { select: { itemGroupId: true } } } }),
    tx.rentalDiscountPlan.findMany({ where: { ...where, status: "enabled" }, select: { id: true, status: true, effectiveTo: true, applicableItemGroupIds: true, applicablePricingGroupIds: true } }),
    tx.rentalCouponTemplate.findMany({ where: { ...where, status: { in: ["active", "scheduled"] } }, select: { id: true, status: true, applicableItemGroupIds: true } }),
    tx.rentalServiceCapacity.findMany({ where: { ...where, status: "enabled", windowEnd: { gt: now } }, select: { id: true, serviceId: true, locationId: true, status: true, windowEnd: true } }),
    tx.rentalValueAddedService.findMany({ where, select: { id: true, status: true, requiresCapacity: true } }),
    tx.rentalFulfillmentOperator.findMany({ where, select: { id: true } })
  ]);
  const businessCompatibility = categoryAdoptionBusinessCompatibility(target, {
    settings: settings ? settings.settings as unknown as TenantRentalBusinessSettings : null, locations, inspections, qualificationTypes, adjustments, pricingPlans, services,
    prices: prices.map((row) => ({ ...row, value: row.rates as unknown as RentalPricingRate[] })),
    rules: rules.map((row) => ({ ...row, sequence: 0, value: row.config as unknown as RentalRuleConfig }))
  }, now);
  const instances = capabilityInstances.map((row) => ({ ...row, code: row.code as RentalCapability, status: row.status as RentalCapabilityLifecycleStatus, config: row.config as RentalCapabilityConfig }));
  const candidateInstances = capabilityPatches.length ? capabilities.prepareAdoptionConfigs(target, instances, capabilityPatches, hooks.registeredVersions()) : instances;
  let conditionalReadiness: ReturnType<typeof workspaceCapabilityRequirements> = { required: [...target.requiredCapabilities], matches: [], checkedItemGroupCount: 0 };
  const conditionalBlockers: Array<{ domain: "conditional_capability"; id: string; message: string }> = [];
  try {
    conditionalReadiness = workspaceCapabilityRequirements(target, records.groups,
      (settings?.settings as unknown as TenantRentalBusinessSettings | undefined)?.fulfillment?.enabledModes);
  } catch (error) {
    conditionalBlockers.push({ domain: "conditional_capability", id: "conditional_capabilities", message: error instanceof Error ? error.message : "条件能力依据缺失" });
  }
  const capabilityCompatibility = capabilities.adoptionCompatibility(target, candidateInstances, hooks.registeredVersions(), undefined, conditionalReadiness.required);
  const inspectionCompositionBlockers: Array<{ domain: "inspection_composition"; id: string; message: string }> = [];
  if (target.conditionalCapabilities?.length) {
    try {
      if (!hooks.assertCategoryComposition || !hooks.assertInspectionComposition) throw new Error("条件能力缺少已注册的检查合同执行器，采用未完成");
      hooks.assertCategoryComposition(target);
      const inactive = target.conditionalCapabilities.map(row => row.code).filter(code => !conditionalReadiness.required.includes(code));
      // Use the same projection as quote/fulfillment snapshots. Default required
      // fields are not appended to a tenant template, and old facts stay intact.
      const templates = inspections.filter(row => row.enabled && row.categoryCode.toLowerCase() === target.code &&
        ["pickup", "return"].includes(row.stage) && categoryAdoptionInspectionFieldsValid(row.fields, true))
        .map(row => projectInspectionTemplatePolicy(target, { ...row, tenantId,
          categoryCode: target.code as RentalCategoryCode, stage: row.stage as "pickup" | "return",
          fields: row.fields as unknown as RentalInspectionTemplate["fields"] }, inactive));
      hooks.assertInspectionComposition(templates, conditionalReadiness.required, candidateInstances as Parameters<CapabilityHookRuntime["assertInspectionComposition"]>[2]);
    } catch (error) {
      inspectionCompositionBlockers.push({ domain: "inspection_composition", id: "conditional_inspection_contract",
        message: error instanceof Error ? error.message : "条件能力检查合同不兼容" });
    }
  }
  const references = categoryAdoptionCapabilityReferences(target, candidateInstances, records);
  const marketing = categoryAdoptionMarketingReferences({ groups: records.groups, pricingGroups, locations, discounts, coupons, services }, now);
  const priceReferences = categoryAdoptionPriceReferences({ groups: records.groups, pricingGroups, prices: prices.map((row) => ({ ...row, value: row.rates })), adjustments, plans: pricingPlans }, now);
  const priceStructure = categoryAdoptionPriceStructure({ prices: prices.map((row) => ({ ...row, value: row.rates })), adjustments, plans: pricingPlans }, now);
  const capacityCompatibility = categoryAdoptionServiceCapacity(target, { services: capacityServices, locations, capacities }, now);
  const productGraph = categoryAdoptionProductGraph(target, { groups: records.groups, assets: records.assets, locations, pricingGroups });
  const settingsExecution = categoryAdoptionSettingsExecutionErrors(settings ? settings.settings : null)
    .map((message) => ({ domain: "settings_execution" as const, id: "settings", message }));
  const compatibility = { ...businessCompatibility, valid: businessCompatibility.valid && capabilityCompatibility.valid && references.valid && marketing.valid && priceReferences.valid && priceStructure.valid && capacityCompatibility.valid && productGraph.valid, blockers: [...businessCompatibility.blockers, ...capabilityCompatibility.blockers, ...references.blockers, ...marketing.blockers, ...priceReferences.blockers, ...priceStructure.blockers, ...capacityCompatibility.blockers, ...productGraph.blockers], checkedCapabilityCodes: capabilityCompatibility.checkedCapabilityCodes,
    scope: `${businessCompatibility.scope}_capability_instances_references_marketing_entity_references_price_target_references_price_structure_service_capacity_locations_product_graph` };
  const fulfillment = categoryAdoptionFulfillmentReferences({ locations, operators });
  return { ...compatibility, valid: compatibility.valid && settingsExecution.length === 0 && fulfillment.valid && conditionalBlockers.length === 0 && inspectionCompositionBlockers.length === 0,
    blockers: [...compatibility.blockers, ...settingsExecution, ...fulfillment.blockers, ...conditionalBlockers, ...inspectionCompositionBlockers],
    requiredCapabilityCodes: conditionalReadiness.required, conditionalReadiness,
    scope: `${compatibility.scope}_calendar_allocation_execution_fulfillment_references_conditional_capability_readiness_inspection_composition` };
}
