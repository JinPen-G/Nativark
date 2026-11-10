import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CATEGORY_ADOPTION_LIMITS } from "@rental-os/shared";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { CategoryAdoptionCapabilityRuntime } from "./category-adoption-capability-writer";
import { readCategoryAdoptionCompatibility } from "./category-adoption-compatibility-reader";
import { SaveTenantRentalBusinessSettingsDto } from "./rental-config-request.dto";
import type { CategoryCapabilityPreparationPatch } from "@rental-os/shared";

function measuredBytes(rows: Array<{ bytes: unknown }>) {
  if (rows.length !== 1 || !Object.hasOwn(rows[0], "bytes") || rows[0].bytes === undefined) {
    throw new ConflictException("最终采用缺少数据库配置大小依据，不能按零处理");
  }
  const value = rows[0].bytes;
  if (value !== null && typeof value !== "bigint" && typeof value !== "number" && !(value instanceof Prisma.Decimal)) {
    throw new ConflictException("数据库配置大小依据格式不可读取，不能按零处理");
  }
  const count = Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new ConflictException("数据库配置大小超过可安全读取范围");
  return count;
}

/** Bound current entity JSON before the writer materializes or changes it. */
export async function assertCategoryAdoptionEntityBounds(tx: Prisma.TransactionClient, tenantId: string, workspaceId: string) {
  const where = { tenantId, workspaceId };
  const counts = await Promise.all([tx.rentalItemGroup.count({ where }), tx.rentalAsset.count({ where })]);
  if (counts.some(count => !Number.isSafeInteger(count) || count < 0) || counts[0] + counts[1] > CATEGORY_ADOPTION_LIMITS.entities) {
    throw new ConflictException("当前型号与资产合计超过10000条或规模不可读取，原版与准备资料保留");
  }
  const bytes = await Promise.all([
    tx.$queryRaw<Array<{ bytes: unknown }>>(Prisma.sql`SELECT SUM(COALESCE(OCTET_LENGTH(attributes), 0)) AS bytes FROM rental_item_groups WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}`),
    tx.$queryRaw<Array<{ bytes: unknown }>>(Prisma.sql`SELECT SUM(COALESCE(OCTET_LENGTH(attributes), 0)) AS bytes FROM rental_assets WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}`)
  ]);
  const storedEntityBytes = bytes.reduce((sum, rows) => sum + measuredBytes(rows), 0);
  if (storedEntityBytes > CATEGORY_ADOPTION_LIMITS.candidateBytes) throw new ConflictException("当前型号/资产JSON超过16MiB采用范围，原版与准备资料保留");
  return { entityCount: counts[0] + counts[1], storedEntityBytes };
}

/** Final scoped configuration gate. Caller holds policy/workspace locks and has
 * applied the candidate entities in this same transaction. Does not authorize
 * people, commit bindings, initialize readiness or change historical snapshots. */
export async function readFinalCategoryAdoptionCompatibility(
  tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  definition: Parameters<typeof readCategoryAdoptionCompatibility>[3],
  records: Parameters<typeof readCategoryAdoptionCompatibility>[4],
  runtime: CategoryAdoptionCapabilityRuntime, now: Date,
  capabilityPatches: CategoryCapabilityPreparationPatch[] = []
) {
  if (records.groups.length + records.assets.length > CATEGORY_ADOPTION_LIMITS.entities) {
    throw new ConflictException("当前型号与资产合计超过10000条的采用范围，原版与准备资料保留");
  }
  if (!runtime.hooks) throw new ConflictException("最终采用缺少实际登记的能力合同执行器");
  runtime.hooks.assertCategoryComposition(definition);
  const where = { tenantId, workspaceId };
  // These are the reader's unique configuration owners. Counting before reads
  // bounds memory; their writers share the held workspace mutex.
  const counts = await Promise.all([
    tx.rentalTenantBusinessSettings.count({ where }), tx.rentalFulfillmentLocation.count({ where }),
    tx.rentalPriceVersion.count({ where }), tx.rentalRuleVersion.count({ where }),
    tx.rentalInspectionTemplate.count({ where }), tx.workspaceCapabilityInstance.count({ where }),
    tx.customerMembershipQualificationType.count({ where }), tx.rentalPriceAdjustmentPlan.count({ where }),
    tx.rentalPricingPlan.count({ where }), tx.rentalValueAddedService.count({ where }),
    tx.rentalPricingGroup.count({ where }), tx.rentalDiscountPlan.count({ where }),
    tx.rentalCouponTemplate.count({ where }), tx.rentalServiceCapacity.count({ where }),
    tx.rentalFulfillmentOperator.count({ where }),
    tx.rentalPricingGroupMember.count({ where: { pricingGroup: { is: where } } }),
    tx.rentalBundleComponent.count({ where: { bundleItemGroup: { is: where } } })
  ]);
  if (counts.some(count => !Number.isSafeInteger(count) || count < 0 || count > CATEGORY_ADOPTION_LIMITS.configurationRowsPerDomain) ||
      counts.reduce((sum, count) => sum + count, 0) > CATEGORY_ADOPTION_LIMITS.configurationRows) {
    throw new ConflictException("经营配置超过当前最终事务支持范围，原版与准备资料保留；请核对配置规模");
  }
  // Fixed owning tables/columns only; no identifiers come from HTTP/config data.
  // Measure JSON in MySQL before materializing potentially large configuration.
  const jsonOwners = [
    ["rental_tenant_business_settings", ["settings"]], ["rental_price_versions", ["rates"]],
    ["rental_rule_versions", ["config"]], ["rental_inspection_templates", ["fields"]],
    ["workspace_capability_instances", ["config"]], ["rental_price_adjustment_plans", ["finalRates"]],
    ["rental_pricing_plans", ["rates", "fulfillmentFees"]],
    ["rental_value_added_services", ["applicableItemGroupIds", "applicableFulfillmentModes", "applicableLocationIds", "mandatoryRule"]],
    ["rental_discount_plans", ["applicableItemGroupIds", "applicablePricingGroupIds"]],
    ["rental_coupon_templates", ["applicableItemGroupIds"]]
  ] as const;
  const byteRows = await Promise.all(jsonOwners.map(([table, columns]) => tx.$queryRaw<Array<{ bytes: bigint | null }>>(Prisma.sql`
    SELECT SUM(${Prisma.join(columns.map(column => Prisma.sql`COALESCE(OCTET_LENGTH(${Prisma.raw(`\`${column}\``)}), 0)`), " + ")}) AS bytes
    FROM ${Prisma.raw(`\`${table}\``)} WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}`)));
  const configurationBytes = byteRows.reduce((sum, rows) => sum + measuredBytes(rows), 0);
  if (!Number.isSafeInteger(configurationBytes) || configurationBytes < 0 || configurationBytes > CATEGORY_ADOPTION_LIMITS.candidateBytes) {
    throw new ConflictException("经营配置JSON超过16MiB最终采用范围，未应用准备资料");
  }
  const [settings, rules, prices] = await Promise.all([
    tx.rentalTenantBusinessSettings.findFirst({ where, select: { settings: true } }),
    tx.rentalRuleVersion.findMany({ where: { ...where, status: { in: ["published", "pending", "superseded"] }, voidedAt: null }, select: { id: true, effectiveFrom: true } }),
    tx.rentalPriceVersion.findMany({ where, select: { id: true, effectiveFrom: true, sequence: true } })
  ]);
  const blockers: Array<{ domain: string; id: string; message: string }> = [];
  let settingsContractChecked = settings === null;
  if (settings) {
    const value = settings.settings;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      blockers.push({ domain: "settings_contract", id: "settings", message: "经营设置缺少可执行结构，请通过经营设置修复" });
    } else {
      // Strip only server-owned metadata. Unknown executor fields stay visible to
      // the real input contract rather than silently disappearing in projection.
      const input = Object.fromEntries(Object.entries(value).filter(([key]) => !["tenantId", "categoryCode", "configVersion", "updatedAt", "updatedBy"].includes(key)));
      const safe = (node: unknown, depth = 0): boolean => {
        if (node === null || typeof node !== "object") return true;
        return depth <= 50 && Object.entries(node).every(([key, child]) => !["__proto__", "constructor", "prototype"].includes(key) && safe(child, depth + 1));
      };
      if (!safe(input)) blockers.push({ domain: "settings_contract", id: "settings", message: "经营设置含不安全结构，不能采用" });
      else {
        const projected = plainToInstance(SaveTenantRentalBusinessSettingsDto, input, { enableImplicitConversion: false });
        const errors = validateSync(projected, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, validationError: { target: false, value: false } });
        if (errors.length) blockers.push({ domain: "settings_contract", id: "settings", message: "当前经营设置未满足正式输入契约，请修复后采用" });
        settingsContractChecked = true;
      }
    }
  }
  for (const rule of rules) if (!rule.effectiveFrom || !Number.isFinite(rule.effectiveFrom.getTime())) {
    blockers.push({ domain: "rule_timeline", id: rule.id, message: "已发行规则缺少生效时点，不能用当前默认规则补造依据" });
  }
  for (const price of prices) if (!Number.isFinite(price.effectiveFrom.getTime()) || !Number.isSafeInteger(price.sequence) || price.sequence < 1) {
    blockers.push({ domain: "price_timeline", id: price.id, message: "价格版本的生效时点或顺序缺失，须通过原价格机制处理" });
  }
  const compatibility = await readCategoryAdoptionCompatibility(tx, tenantId, workspaceId, definition, records,
    runtime.capabilities, runtime.hooks, now, capabilityPatches);
  // Candidate attributes are checked by the entity writer; this bound covers
  // their stored historical fields too. No truncation or staged activation.
  const candidateBytes = configurationBytes + Buffer.byteLength(JSON.stringify({ records, compatibility, capabilityPatches }));
  if (candidateBytes > CATEGORY_ADOPTION_LIMITS.candidateBytes) throw new ConflictException("采用候选超过16MiB处理范围，原事实与准备保留");
  return { ...compatibility, valid: compatibility.valid && blockers.length === 0,
    blockers: [...compatibility.blockers, ...blockers],
    complete: settingsContractChecked,
    coverage: { entityCount: records.groups.length + records.assets.length, configurationCounts: counts,
      configurationRowCount: counts.reduce((sum, count) => sum + count, 0), configurationBytes, candidateBytes,
      settingsContractChecked, registeredCompositionChecked: true, timelinesChecked: true },
    scope: `${compatibility.scope}_full_settings_contract_timelines_registered_composition_bounded_scoped_collection` };
}
