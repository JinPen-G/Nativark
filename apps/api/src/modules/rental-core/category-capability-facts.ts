/** Core capability facts under the caller's existing workspace mutex. New quote
 * commits recheck the complete enabled snapshot; historical actions retain their
 * original conditional check. No independent transaction or authorization. */
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { RENTAL_CAPABILITY_CODES, RENTAL_CORE_CAPABILITY_CODES, type RentalCapability, type RentalInventoryMode, type RentalQuoteRequest, type RentalQuoteSnapshotV1, type RentalWorkspaceCapabilitySnapshotEntry } from "@rental-os/shared";
import { resolveRentalCategoryVersionBody } from "./rental-category-resolver.service";
import { capabilityRequirementRoots, captureCapabilityRequirements, resolveCapabilityRequirements } from "./category-capability-conditions";

/** New quote creation only. A matching category binding does not prove that an
 * ordinary required or optional enabled instance still matches its earlier Hook
 * decision. Compare every enabled instance, including newly enabled ones, before
 * committing. Never apply this current-state gate to saved quotes or old orders. */
export async function validateNewQuoteCapabilitySnapshot(tx: Prisma.TransactionClient, workspaceId: string,
  quote: Pick<RentalQuoteSnapshotV1, "tenantId" | "categoryCode" | "categoryVersionId" | "capabilityRequirementsSnapshot" | "capabilitySnapshot">
) {
  if (!quote.categoryVersionId && quote.capabilitySnapshot === undefined) return; // Explicit unversioned legacy path.
  const required = quote.categoryVersionId
    ? resolveCapabilityRequirements(resolveRentalCategoryVersionBody(
      await tx.rentalCategoryVersion.findUnique({ where: { id: quote.categoryVersionId } }), quote.categoryCode),
      quote.capabilityRequirementsSnapshot).required
    : [];
  const normalize = (rows: unknown): RentalWorkspaceCapabilitySnapshotEntry[] => {
    if (!Array.isArray(rows) || rows.length > RENTAL_CAPABILITY_CODES.length) {
      throw new ConflictException("新报价能力快照缺失或超过已登记范围，请重新报价");
    }
    const codes = new Set<string>();
    return rows.map(row => {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
        !RENTAL_CAPABILITY_CODES.includes(row.code) || codes.has(row.code) ||
        typeof row.implementationVersion !== "string" || !row.implementationVersion.trim() ||
        typeof row.configVersion !== "string" || !row.configVersion.trim() ||
        !row.config || typeof row.config !== "object" || Array.isArray(row.config)) {
        throw new ConflictException("新报价能力版本或配置来源不可读取，请重新报价");
      }
      codes.add(row.code);
      return { code: row.code, implementationVersion: row.implementationVersion,
        configVersion: row.configVersion, config: row.config };
    }).sort((left, right) => left.code.localeCompare(right.code));
  };
  // A versioned new quote records an explicit empty set when no instances were
  // enabled. Missing evidence is not that same observation.
  const quoted = normalize(quote.capabilitySnapshot);
  const rows = await tx.workspaceCapabilityInstance.findMany({
    where: { tenantId: quote.tenantId, workspaceId, status: "enabled" },
    select: { code: true, implementationVersion: true, configVersion: true, config: true },
    orderBy: { code: "asc" }, take: RENTAL_CAPABILITY_CODES.length + 1
  });
  const current = normalize(rows);
  const core = new Set<RentalCapability>(RENTAL_CORE_CAPABILITY_CODES);
  if (required.some(code => !core.has(code) && !current.some(row => row.code === code))) {
    throw new ConflictException("新报价必需能力尚未启用，请核对当前空间后重新报价");
  }
  if (!isDeepStrictEqual(quoted, current)) {
    throw new ConflictException("已启用能力在报价期间已变化，请读取当前配置后重新报价");
  }
}

export async function validateQuotedCapabilityRequirements(tx: Prisma.TransactionClient, workspaceId: string,
  quote: Pick<RentalQuoteSnapshotV1, "tenantId" | "categoryCode" | "categoryVersionId" | "capabilityRequirementsSnapshot" | "capabilitySnapshot"> &
    { request: Pick<RentalQuoteRequest, "lines" | "fulfillmentMode"> }) {
  if (!quote.categoryVersionId) {
    if (quote.capabilityRequirementsSnapshot) throw new ConflictException("条件报价必须引用不可变发布版本");
    return;
  }
  const version = await tx.rentalCategoryVersion.findUnique({ where: { id: quote.categoryVersionId } });
  const definition = resolveRentalCategoryVersionBody(version, quote.categoryCode);
  if (!definition.conditionalCapabilities?.length) {
    if (quote.capabilityRequirementsSnapshot) throw new ConflictException("报价条件依据与品类政策不一致");
    return;
  }
  const original = resolveCapabilityRequirements(definition, quote.capabilityRequirementsSnapshot);
  const roots = capabilityRequirementRoots(quote.request.lines);
  const groups: Parameters<typeof captureCapabilityRequirements>[1][number][] = [];
  const read = new Set<string>();
  let pending = roots;
  while (pending.length) {
    if (read.size + pending.length > 1000) throw new ConflictException("条件报价的商品范围超过支持上限");
    const rows = await tx.rentalItemGroup.findMany({ where: { tenantId: quote.tenantId, workspaceId, id: { in: pending } },
      select: { id: true, inventoryMode: true, attributes: true, bundleComponents: {
        select: { componentItemGroupId: true, optional: true }
      } } });
    if (rows.length !== pending.length) throw new ConflictException("报价商品或套装组成已变化，请重新报价");
    const next = new Set<string>();
    for (const row of rows) {
      read.add(row.id);
      const inventoryMode = row.inventoryMode.toLowerCase() as RentalInventoryMode;
      const components = inventoryMode === "bundle" ? row.bundleComponents.map(component => ({ itemGroupId: component.componentItemGroupId, optional: component.optional })) : [];
      groups.push({ id: row.id, inventoryMode,
        attributes: row.attributes as Record<string, unknown>, bundleComponents: components });
      for (const component of components) if (!component.optional && !read.has(component.itemGroupId)) next.add(component.itemGroupId);
    }
    pending = [...next].filter(id => !read.has(id));
  }
  const current = captureCapabilityRequirements(definition, groups, roots, quote.request.fulfillmentMode);
  if (!isDeepStrictEqual(current, quote.capabilityRequirementsSnapshot)) throw new ConflictException("商品分类或套装组成在报价期间已变化，请重新报价");
  const core = new Set<RentalCapability>(RENTAL_CORE_CAPABILITY_CODES);
  const required = original.required.filter(code => !core.has(code));
  if (!required.length) return;
  const instances = await tx.workspaceCapabilityInstance.findMany({ where: { tenantId: quote.tenantId, workspaceId, code: { in: required }, status: "enabled" } });
  for (const code of required) {
    const current = instances.find(instance => instance.code === code);
    const quoted = quote.capabilitySnapshot?.find(instance => instance.code === code);
    if (!current || !quoted || current.implementationVersion !== quoted.implementationVersion || current.configVersion !== quoted.configVersion || !isDeepStrictEqual(current.config, quoted.config)) {
      throw new ConflictException("条件必需能力在报价期间已变更，请核对后重新报价");
    }
  }
}
