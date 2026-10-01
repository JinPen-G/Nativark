import type { RentalCategoryDefinition, RentalPricingRate, RentalRuleConfig, TenantRentalBusinessSettings } from "@rental-os/shared";
import { categoryPricingRuleError } from "./category-pricing-rule-compatibility";

export interface CategoryTimedConfiguration<T> { id: string; effectiveFrom: Date | null; sequence: number; value: T }

/** Check executable tenant templates, not the platform's replacement defaults. */
export function categoryAdoptionInspectionFieldsValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  const codes = new Set<string>();
  for (const field of value) {
    if (!field || typeof field !== "object" || Array.isArray(field)) return false;
    if (typeof field.code !== "string" || !field.code.trim() || ["__proto__", "constructor", "prototype"].includes(field.code) || codes.has(field.code)) return false;
    codes.add(field.code);
    if (typeof field.label !== "string" || !field.label.trim() || typeof field.required !== "boolean") return false;
    if (!["boolean", "number", "text", "select", "photo"].includes(field.type)) return false;
    if (field.usageMetric !== undefined && (typeof field.usageMetric !== "boolean" || (field.usageMetric && field.type !== "number"))) return false;
    if (field.type === "select" && (!Array.isArray(field.options) || field.options.length === 0 || field.options.some((option: unknown) => typeof option !== "string" || !option.trim()) || new Set(field.options).size !== field.options.length)) return false;
  }
  return true;
}

/** Current and scheduled immutable configurations only. Historical snapshots remain executable under their original category. */
export function categoryCurrentAndFuture<T>(rows: CategoryTimedConfiguration<T>[], now: Date): CategoryTimedConfiguration<T>[] {
  const dated = rows.filter((row) => row.effectiveFrom && Number.isFinite(row.effectiveFrom.getTime()));
  const ordered = [...dated].sort((a, b) => b.effectiveFrom!.getTime() - a.effectiveFrom!.getTime() || b.sequence - a.sequence);
  const current = ordered.find((row) => row.effectiveFrom!.getTime() <= now.getTime());
  // Price versions have unique sequences. For rules, equal sequences preserve
  // every ambiguous candidate instead of silently picking a compatible one.
  const highestSequence = new Map<number, number>();
  for (const row of ordered) {
    const at = row.effectiveFrom!.getTime();
    highestSequence.set(at, Math.max(highestSequence.get(at) ?? -Infinity, row.sequence));
  }
  const winners = ordered.filter((row) => row.sequence === highestSequence.get(row.effectiveFrom!.getTime()));
  const future = winners.filter((row) => row.effectiveFrom!.getTime() > now.getTime());
  return current ? [...winners.filter((row) => row.effectiveFrom!.getTime() === current.effectiveFrom!.getTime()), ...future] : future;
}

export function categoryAdoptionBusinessCompatibility(target: RentalCategoryDefinition, input: {
  settings: TenantRentalBusinessSettings | null;
  locations: Array<{ id: string; type: string; status: string }>;
  prices: CategoryTimedConfiguration<RentalPricingRate[]>[];
  rules: CategoryTimedConfiguration<RentalRuleConfig>[];
  inspections?: Array<{ id: string; stage: string; enabled: boolean; fields: unknown }>;
  qualificationTypes?: Array<{ code: string; categoryCode: string; capabilityCode: string | null; status: string }>;
  adjustments?: Array<{ id: string; status: string; finalRates: unknown }>;
  pricingPlans?: Array<{ id: string; status: string; effectiveTo: Date | null; fulfillmentFees: unknown }>;
  services?: Array<{ id: string; status: string; applicableFulfillmentModes: unknown; mandatoryRule: unknown }>;
}, now: Date) {
  const blockers: Array<{ domain: "settings" | "location" | "price" | "rule" | "inspection" | "service"; id: string; message: string }> = [];
  const add = (domain: typeof blockers[number]["domain"], id: string, message: string) => blockers.push({ domain, id, message });
  const model = target.businessModel;
  if (input.settings) {
    const settings = input.settings;
    if (settings.pricing.enabledUnits.some((unit) => !model.pricingUnits.includes(unit))) add("settings", "pricing.enabledUnits", "现有启用计价单位不在目标品类范围，请通过经营设置调整");
    if (!model.pricingUnits.includes(settings.pricing.defaultUnit) || !settings.pricing.enabledUnits.includes(settings.pricing.defaultUnit)) add("settings", "pricing.defaultUnit", "现有默认计价单位不兼容目标品类");
    if (settings.fulfillment.enabledModes.some((mode) => !model.fulfillmentModes.includes(mode))) add("settings", "fulfillment.enabledModes", "现有启用履约方式不在目标品类范围，请通过经营设置调整");
    if (!model.supportsHolidayPricing && (settings.pricing.holidayPricingEnabled || settings.calendar.holidayPricingEnabled)) add("settings", "holidayPricingEnabled", "目标品类不支持当前启用的节假日计价设置");
  }
  for (const location of input.locations) {
    if (location.status === "enabled" && !model.locationTypes.includes(location.type as typeof model.locationTypes[number])) add("location", location.id, "启用地点类型不在目标品类范围，请先处理地点");
  }
  const prices = categoryCurrentAndFuture(input.prices, now);
  for (const price of prices) {
    if (!Array.isArray(price.value) || price.value.some((rate) => !model.pricingUnits.includes(rate.unit))) add("price", price.id, "当前或未来价格版本包含目标品类不支持的计价单位，需通过价格发布机制处理");
  }
  // Confirmed adjustments are executable future prices, even before a version
  // row exists. Drafts/cancelled/applied records are not future commitments.
  for (const adjustment of input.adjustments ?? []) {
    if (adjustment.status !== "pending") continue;
    if (!Array.isArray(adjustment.finalRates) || adjustment.finalRates.length === 0 || adjustment.finalRates.some((rate) => !rate || typeof rate !== "object" || !model.pricingUnits.includes(rate.unit))) {
      add("price", adjustment.id, "待生效调价的锁定费率缺失或包含目标品类不支持的计价单位，请先取消或处理调价计划");
    }
  }
  for (const plan of input.pricingPlans ?? []) {
    if (plan.status !== "enabled" || (plan.effectiveTo && plan.effectiveTo.getTime() <= now.getTime()) || plan.fulfillmentFees === null) continue;
    if (!Array.isArray(plan.fulfillmentFees) || plan.fulfillmentFees.some((fee) => !fee || typeof fee !== "object" || !model.fulfillmentModes.includes(fee.mode))) {
      add("price", `${plan.id}:fulfillmentFees`, "启用价格计划的履约收费方式不兼容目标品类，请通过定价配置调整");
    }
  }
  const compatibleServiceModes = (value: unknown) => value === null || value === undefined
    || (Array.isArray(value) && value.every((mode) => typeof mode === "string" && model.fulfillmentModes.includes(mode as typeof model.fulfillmentModes[number])));
  for (const service of input.services ?? []) {
    if (service.status !== "enabled") continue;
    if (!compatibleServiceModes(service.applicableFulfillmentModes)) {
      add("service", `${service.id}:fulfillmentModes`, "启用增值服务的适用履约方式不兼容目标品类，请通过服务配置调整");
    }
    if (service.mandatoryRule !== null && service.mandatoryRule !== undefined) {
      if (typeof service.mandatoryRule !== "object" || Array.isArray(service.mandatoryRule)
        || !compatibleServiceModes((service.mandatoryRule as Record<string, unknown>).fulfillmentModes)) {
        add("service", `${service.id}:mandatoryRule`, "启用增值服务的强制触发履约条件不兼容目标品类，请通过服务配置调整");
      }
    }
  }
  const rules = categoryCurrentAndFuture(input.rules, now);
  const ruleCounts = new Map<number, number>();
  for (const rule of rules) {
    const at = rule.effectiveFrom!.getTime();
    ruleCounts.set(at, (ruleCounts.get(at) ?? 0) + 1);
  }
  for (const rule of rules) {
    if (ruleCounts.get(rule.effectiveFrom!.getTime())! > 1) add("rule", rule.id, "同一生效时点存在多个规则版本，请通过规则作废机制处理歧义");
  }
  for (const rule of rules) {
    const error = categoryPricingRuleError(model.pricingUnits, rule.value);
    if (error) add("rule", rule.id, error);
    const payment = rule.value.payment;
    if (!model.supportsPreauthorization && (payment.preauthorizationRequired || payment.depositMode === "preauthorization" || (rule.value.preauthorization && rule.value.preauthorization.mode !== "none"))) add("rule", rule.id, "当前或未来规则启用预授权，但目标品类不支持");
    if (!model.supportsPreauthorization && rule.value.membershipSecurityReduction?.preauthorization?.enabled) add("rule", rule.id, "当前或未来规则启用会员预授权减免，但目标品类不支持");
    if (!model.supportsQualificationReview && rule.value.qualification?.required) add("rule", rule.id, "当前或未来规则要求资质审核，但目标品类不支持，请通过规则发布机制调整");
    if (rule.value.qualification?.required && input.qualificationTypes) {
      const codes = rule.value.qualification.documentTypes;
      if (!Array.isArray(codes) || codes.length === 0) add("rule", rule.id, "要求资质审核的规则未指定有效证件类型");
      else for (const code of codes) {
        const type = input.qualificationTypes.find((row) => row.code === code && row.status === "enabled" && row.categoryCode.toLowerCase() === target.code);
        if (!type || (type.capabilityCode && ![...target.defaultCapabilities, ...target.requiredCapabilities].some((capability) => capability === type.capabilityCode))) add("rule", `${rule.id}:qualification:${code}`, "当前或未来规则要求的证件类型未在本空间启用，或依赖目标品类未声明的能力");
      }
    }
    // Existing tenant templates are business facts, not category defaults. Never
    // replace them automatically when the platform changes its default fields.
    if (input.inspections) {
      for (const stage of ["pickup", "return"] as const) {
        const required = stage === "pickup" ? rule.value.fulfillment?.pickupInspectionRequired : rule.value.fulfillment?.returnInspectionRequired;
        if (required && !input.inspections.some((template) => template.enabled && template.stage === stage && categoryAdoptionInspectionFieldsValid(template.fields))) add("inspection", `${rule.id}:${stage}`, `当前或未来规则要求${stage === "pickup" ? "领取" : "归还"}检查，但没有有效且非空的启用模板`);
      }
    }
  }
  return { valid: blockers.length === 0, blockers, checkedPriceVersionIds: prices.map((row) => row.id), checkedRuleVersionIds: rules.map((row) => row.id),
    scope: "settings_locations_price_units_pending_adjustments_fulfillment_fees_service_fulfillment_modes_rule_pricing_preauthorization_qualification_inspection_structure", complete: false as const };
}
