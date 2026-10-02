import { RENTAL_CORE_CAPABILITY_CODES, type RentalCategoryDefinition } from "@rental-os/shared";

/** Existing Core capabilities have no separately implemented subscription product.
 * This preserves current charging behavior, NOT a declaration of future pricing.
 * New executable capabilities must explicitly register [] or actual existing
 * feature codes here. Category JSON and callers cannot invent commercial codes. */
export const CATEGORY_COMMERCIAL_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = Object.freeze(Object.fromEntries([
  "serialized_inventory", "quantity_inventory", "bundle_inventory", "pickup", "return", "delivery",
  "locker", "dispatch", "usage_reading", "qualification", "iot", "camera_kit_handover",
  "camping_kit_integrity", "camping_cleaning_turnaround", "inspection_care", "vehicle_relocation",
  "construction_transport", "camera_compatibility"
].map((code) => [code, Object.freeze([] as string[])])));

export function categoryCommercialRequirements(target: RentalCategoryDefinition,
  instances: Array<{ code: string; status: string }>,
  registry: Readonly<Record<string, readonly string[]>> = CATEGORY_COMMERCIAL_REQUIREMENTS
) {
  const builtins = new Set<string>(RENTAL_CORE_CAPABILITY_CODES);
  const capabilityCodes = [...new Set([...target.requiredCapabilities, ...target.defaultCapabilities.filter((code) => builtins.has(code)),
    ...instances.filter((row) => row.status === "enabled").map((row) => row.code)])].sort();
  const blockers: Array<{ domain: "commercial"; id: string; message: string }> = [];
  const featureCodes = new Set<string>();
  for (const code of capabilityCodes) {
    const requirements = Object.hasOwn(registry, code) ? registry[code] : undefined;
    if (!Array.isArray(requirements) || requirements.some((feature) => typeof feature !== "string" || !feature.trim() || feature !== feature.trim() || feature.length > 191)) {
      blockers.push({ domain: "commercial", id: code, message: "能力商业依赖未明确登记，请联系平台核对；不会自动新增收费项或降级绕过" });
      continue;
    }
    for (const feature of requirements) featureCodes.add(feature);
  }
  return { valid: blockers.length === 0, capabilityCodes, featureCodes: [...featureCodes].sort(), blockers };
}

export function categoryCommercialCompatibility(categoryCode: string,
  requirements: ReturnType<typeof categoryCommercialRequirements>,
  context: { newBusinessAllowed: boolean; entitlements: Array<{ code: string; categories: string[]; available: boolean }> }
) {
  const blockers = [...requirements.blockers];
  if (!context.newBusinessAllowed) blockers.push({ domain: "commercial", id: "subscription_term", message: "当前订阅已到期，采用新版本前请办理续期；资料准备与既有订单善后不会被自动修改" });
  for (const code of requirements.featureCodes) {
    const entries = context.entitlements.filter((row) => row.code === code);
    const entry = entries.length === 1 ? entries[0] : undefined;
    if (!entry || !entry.available || !Array.isArray(entry.categories) || (entry.categories.length && !entry.categories.includes(categoryCode))) {
      blockers.push({ domain: "commercial", id: code, message: "目标能力所需商业权益未授权、未交付或不适用于本品类，请办理授权后重试；不会自动启用能力" });
    }
  }
  return { valid: blockers.length === 0, blockers, checkedFeatureCodes: requirements.featureCodes, checkedCapabilityCodes: requirements.capabilityCodes,
    scope: "code_owned_capability_commercial_requirements_and_subscription_entitlements", complete: false as const };
}
