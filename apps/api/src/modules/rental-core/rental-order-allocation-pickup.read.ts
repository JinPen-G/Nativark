/** One authorized allocation's current asset and original pickup evidence.
 * No asset enumeration, current-template fallback, writes or new transaction.
 * JSON is bounded before transport; row/scope changes refuse a late result. */
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaService } from "../database/prisma.service";
import type { RentalAttributeDefinition } from "@rental-os/shared";
import type { ResolvedRentalCategory } from "./rental-category-resolver.service";
import { getRequestIdentity } from "../../common/request-identity";
import { requestFingerprint } from "./rental-idempotency.repository";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { readRentalCategoryCode } from "./category-identity";
import { normalizedRentalAttributeValue, reconcileRentalCategoryAttributes, validateRentalCategoryAttributes } from "./rental-category-attributes";
import { optionalUsageReading, usageDelta } from "./rental-usage-reading";

const JSON_LIMIT = 65_536;
const READING_LIMIT = 100;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 191;
const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const invalid = () => new ConflictException("分配资产或原领取依据来源不可核对");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const parse = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { throw invalid(); }
};
// A wrong container denotes overflow without reserving a legal attribute code.
const bounded = (value: Prisma.Sql, type: "OBJECT" | "ARRAY", count?: number) => Prisma.sql`CASE
  WHEN JSON_TYPE(${value}) IS NULL OR JSON_TYPE(${value}) = 'NULL' THEN NULL
  WHEN JSON_TYPE(${value}) = ${type} AND OCTET_LENGTH(CAST(${value} AS CHAR)) <= ${JSON_LIMIT}
    ${count === undefined ? Prisma.empty : Prisma.sql`AND JSON_LENGTH(${value}) <= ${count}`} THEN ${value}
  ELSE ${type === "OBJECT" ? Prisma.sql`JSON_ARRAY()` : Prisma.sql`JSON_OBJECT()`} END`;

export interface RentalAllocationPickupInput {
  tenantId: string; workspaceId: string; orderId: string; categoryCode: string; sourceOrderUpdatedAt: string;
  allocation: { id: string; orderLineId: string; itemGroupId?: string; assetId?: string; assetNo?: string;
    quantity: number; status: string; updatedAt: string; exchangeId?: string };
  asset?: { id: string; itemGroupId: string; serialNo?: string; updatedAt: string; attributes: Record<string, unknown>;
    itemGroupAttributes: Record<string, unknown> };
  pickup?: { id: string; revision: number; updatedAt: string; createdAt: string; templateId: string;
    templateCode: string; templateVersion: string; exchangeId?: string;
    binding: { allocationId: string; itemGroupId: string; assetId: string; quantity: number };
    resourceCount: number; usageReadings: unknown[]; usageCorrections: unknown[];
    originalReadings?: Record<string, unknown>; fields?: unknown[] };
  missingAssetReason?: "asset_reference_missing" | "asset_not_visible_or_missing";
  missingPickupReason?: "asset_reference_missing" | "allocation_pickup_binding_not_recorded";
}

function frozenUsageFields(fields: unknown[]) {
  const codes = new Set<string>();
  return fields.flatMap(value => {
    if (!object(value) || !text(value.code) || ["__proto__", "prototype", "constructor"].includes(value.code)
      || codes.has(value.code) || !["boolean", "number", "text", "select", "photo"].includes(String(value.type))
      || typeof value.required !== "boolean" || value.usageMetric !== undefined && typeof value.usageMetric !== "boolean"
      || value.unit !== undefined && (typeof value.unit !== "string" || value.unit.length > 191)) throw invalid();
    codes.add(value.code);
    if (value.usageMetric !== true) return [];
    if (value.type !== "number") throw invalid();
    return [{ code: value.code, unit: value.unit as string | undefined }];
  });
}

/** Project persisted data with the original Core validators. Current attributes
 * and frozen pickup units stay separate; the hash is this read's projection,
 * never a fabricated historical schema/record version or action permission. */
export function projectAllocationPickupBasis(input: RentalAllocationPickupInput, current?: ResolvedRentalCategory) {
  const attributes = (fields: RentalAttributeDefinition[], scope: "item_group" | "asset", values: Record<string, unknown>, serialNo?: string) => {
    const active = reconcileRentalCategoryAttributes(fields, scope, values, values).active;
    if (scope === "asset") delete active.serialNo;
    try { validateRentalCategoryAttributes(fields, scope, active, scope === "asset" ? { serialNo } : {}, false); }
    catch { throw new ConflictException("当前受权资产资料与品类字段定义不一致"); }
    return fields.filter(field => field.scope === scope).map(field => {
      const value = scope === "asset" && field.code === "serialNo" ? serialNo : active[field.code];
      const normalizedValue = normalizedRentalAttributeValue(value);
      // Missing data does not retire its current required/unique/option rules.
      // Preserve the original optional flags; do not invent identifier formats.
      return { scope, code: field.code, label: field.label, type: field.type,
        required: field.required, unique: field.unique, options: field.options === undefined ? undefined : [...field.options],
        unit: field.unit, valueState: normalizedValue === undefined ? "not_recorded" as const : "recorded" as const,
        value: normalizedValue === undefined ? null : value as string | number | boolean, normalizedValue: normalizedValue ?? null };
    });
  };
  if (input.asset && (!current || current.workspaceId !== input.workspaceId
    || current.definition.code !== readRentalCategoryCode(input.categoryCode))) {
    throw new ServiceUnavailableException("当前资产的受权品类定义不可用");
  }
  const currentAsset = input.asset ? { state: "recorded" as const, id: input.asset.id, itemGroupId: input.asset.itemGroupId,
    serialNo: input.asset.serialNo, normalizedSerialNo: normalizedRentalAttributeValue(input.asset.serialNo), updatedAt: input.asset.updatedAt,
    schema: { source: "current_workspace" as const, categoryCode: current!.definition.code,
      categoryVersionId: current!.categoryVersionId, adoptionRevision: current!.adoptionRevision,
      definitionVersion: current!.definition.version, validator: "rental-category-attributes" as const },
    fields: [...attributes(current!.definition.businessModel.assetFields, "item_group", input.asset.itemGroupAttributes),
      ...attributes(current!.definition.businessModel.assetFields, "asset", input.asset.attributes, input.asset.serialNo)] }
    : { state: "not_recorded" as const, reason: input.missingAssetReason! };
  const reading = (value: unknown) => {
    try { return optionalUsageReading(value, "原领取读数"); } catch { throw invalid(); }
  };
  const source = input.pickup;
  const usage = (() => {
    if (!source?.fields) return { state: "not_recorded" as const, reason: "frozen_usage_fields_missing" as const, fields: [] };
    const fields = frozenUsageFields(source.fields);
    if (!fields.length) return { state: "not_recorded" as const, reason: "no_frozen_usage_fields" as const, fields: [] };
    const codes = new Set(fields.map(field => field.code)), readings = new Map<string, Record<string, unknown>>(), correctionIds = new Set<string>();
    for (const entry of source.usageReadings) {
      if (!object(entry) || !text(entry.fieldCode) || !codes.has(entry.fieldCode) || readings.has(entry.fieldCode)) throw invalid();
      const currentReading = reading(entry.current), baseline = reading(entry.baseline), delta = reading(entry.delta);
      if (currentReading !== undefined) {
        let expectedDelta: number | undefined;
        try { expectedDelta = usageDelta(currentReading, baseline); } catch { throw invalid(); }
        if (delta !== undefined && delta !== expectedDelta) throw invalid();
      } else if (baseline !== undefined || delta !== undefined) throw invalid();
      readings.set(entry.fieldCode, entry);
    }
    const corrections = source.usageCorrections.map(entry => {
      if (!object(entry) || !text(entry.id) || correctionIds.has(entry.id) || !text(entry.fieldCode) || !codes.has(entry.fieldCode)
        || typeof entry.correctedAt !== "string" || !Number.isFinite(Date.parse(entry.correctedAt))
        || !Array.isArray(entry.evidenceAttachments) || entry.evidenceAttachments.some(value => !text(value))) throw invalid();
      const from = reading(entry.from), to = reading(entry.to);
      if (from === undefined || to === undefined) throw invalid();
      correctionIds.add(entry.id);
      return { id: entry.id, fieldCode: entry.fieldCode, from, to, correctedAt: entry.correctedAt,
        evidenceRecorded: entry.evidenceAttachments.length > 0 };
    });
    const projected = fields.map(field => {
      const original = reading(source.originalReadings?.[field.code]), effective = reading(readings.get(field.code)?.current) ?? original;
      const fieldCorrections = corrections.filter(entry => entry.fieldCode === field.code);
      let previous = original;
      for (const correction of fieldCorrections) {
        if (previous === undefined || correction.from !== previous) throw invalid();
        previous = correction.to;
      }
      if (original !== undefined && effective !== previous) throw invalid();
      const reason = source.resourceCount !== 1 ? "pickup_reading_not_resource_specific" as const
        : !field.unit?.trim() ? "frozen_unit_missing" as const
        : original === undefined ? "original_pickup_reading_missing" as const : undefined;
      return reason ? { fieldCode: field.code, state: "not_recorded" as const, reason }
        : { fieldCode: field.code, state: "recorded" as const, unit: field.unit!, original: original!, current: effective!, corrections: fieldCorrections };
    });
    return { state: projected.every(field => field.state === "recorded") ? "recorded" as const : "not_recorded" as const,
      fields: projected };
  })();
  const pickup = source ? { state: "recorded" as const, recordId: source.id, recordRevision: source.revision,
    updatedAt: source.updatedAt, createdAt: source.createdAt,
    template: { id: source.templateId, code: source.templateCode, version: source.templateVersion, source: "frozen_business_snapshot" as const },
    resourceBinding: { ...source.binding }, ...(source.exchangeId ? { exchangeId: source.exchangeId } : {}), usage }
    : { state: "not_recorded" as const, reason: input.missingPickupReason! };
  const projection = { contractVersion: "rental-order-allocation-pickup-basis-1" as const, tenantId: input.tenantId,
    workspaceId: input.workspaceId, orderId: input.orderId, sourceOrderUpdatedAt: input.sourceOrderUpdatedAt,
    allocation: { ...input.allocation }, currentAsset, pickup,
    semantics: "current_authorized_asset_and_original_pickup_not_execution_authority" as const };
  return { ...projection, projectionHash: requestFingerprint(projection),
    hashSemantics: "sha256_of_persisted_read_projection_not_historical_version" as const };
}

export type RentalOrderAllocationPickupBasis = ReturnType<typeof projectAllocationPickupBasis>;

export async function readAllocationPickupInput(prisma: PrismaService, tenantId: string, workspaceId: string,
  orderId: string, allocationId: string, orderVisibility: () => Prisma.RentalOrderWhereInput,
  assetVisibility: (assetId: string) => Promise<Prisma.RentalAssetWhereInput>): Promise<RentalAllocationPickupInput> {
  const identity = getRequestIdentity(), identityHash = requestFingerprint(identity);
  if (!identity?.userId || identity.isSaasAdmin || !["operator", "staff"].includes(identity.audience ?? "")
    || identity.tenantId !== tenantId || identity.workspaceId !== workspaceId || !text(orderId) || !text(allocationId)) {
    throw new ForbiddenException("领取资源读取缺少当前原营运范围");
  }
  if (await resolveScopeWorkspaceId(prisma, tenantId) !== workspaceId) throw new ForbiddenException("领取资源读取空间变化");
  const parentWhere = () => ({ id: orderId, tenantId, workspaceId, AND: [orderVisibility()] });
  const parentSelect = { id: true, tenantId: true, workspaceId: true, categoryCode: true, updatedAt: true } as const;
  const parent = await prisma.rentalOrder.findFirst({ where: parentWhere(), select: parentSelect });
  if (!parent) throw new NotFoundException("订单不在当前读取范围");
  if (parent.id !== orderId || parent.tenantId !== tenantId || parent.workspaceId !== workspaceId || !date(parent.updatedAt)) throw invalid();
  const sourceOrderTime = parent.updatedAt.getTime();
  const allocationSelect = { id: true, orderId: true, orderLineId: true, itemGroupId: true, assetId: true,
    assetNo: true, quantity: true, status: true, updatedAt: true,
    orderLine: { select: { orderId: true } } } as const;
  const allocationWhere = () => ({ id: allocationId, orderId, order: parentWhere() });
  const allocation = await prisma.rentalAllocation.findFirst({ where: allocationWhere(), select: allocationSelect });
  if (!allocation || allocation.id !== allocationId || allocation.orderId !== orderId || allocation.orderLine?.orderId !== orderId) throw new NotFoundException("分配项不属于当前订单");
  if (!text(allocation.orderLineId) || !date(allocation.updatedAt) || !Number.isSafeInteger(allocation.quantity) || allocation.quantity < 1
    || allocation.assetId !== null && !text(allocation.assetId) || allocation.assetNo !== null && !text(allocation.assetNo)
    || !["pre_assigned", "locked", "allocated", "picked_up", "consumed", "returned", "released"].includes(allocation.status)) throw invalid();
  const sourceAllocationTime = allocation.updatedAt.getTime();
  const links = await prisma.$queryRaw<Array<{ id: string; updatedAt: Date; metadataType: string | null;
    exchangeType: string | null; exchangeId: unknown }>>(Prisma.sql`SELECT a.id, a.updatedAt,
      JSON_TYPE(a.metadata) AS metadataType, JSON_TYPE(JSON_EXTRACT(a.metadata, '$.exchangeId')) AS exchangeType,
      LEFT(JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.exchangeId')), 192) AS exchangeId
    FROM rental_allocations a JOIN rental_orders o ON o.id = a.orderId
    WHERE a.id = ${allocationId} AND a.orderId = ${orderId} AND o.tenantId = ${tenantId}
      AND o.workspaceId = ${workspaceId} AND o.updatedAt = ${parent.updatedAt} LIMIT 1`);
  const link = links[0];
  if (links.length !== 1 || link.id !== allocation.id || !date(link.updatedAt)
    || link.updatedAt.getTime() !== allocation.updatedAt.getTime()
    || ![null, "NULL", "OBJECT"].includes(link.metadataType)
    || link.exchangeType !== null && (link.exchangeType !== "STRING" || !text(link.exchangeId))) throw invalid();
  const exchangeId = link.exchangeType === "STRING" ? link.exchangeId as string : undefined;
  const result: RentalAllocationPickupInput = { tenantId, workspaceId, orderId, categoryCode: parent.categoryCode,
    sourceOrderUpdatedAt: parent.updatedAt.toISOString(), allocation: { id: allocation.id, orderLineId: allocation.orderLineId,
      itemGroupId: allocation.itemGroupId ?? undefined, assetId: allocation.assetId ?? undefined, assetNo: allocation.assetNo ?? undefined,
      quantity: allocation.quantity, status: allocation.status, updatedAt: allocation.updatedAt.toISOString(), exchangeId } };
  let assetBefore: { id: string; tenantId: string; workspaceId: string; itemGroupId: string; updatedAt: Date;
    itemGroup: { id: string; tenantId: string; workspaceId: string; updatedAt: Date } } | null = null;
  let assetTimes: { asset: number; itemGroup: number } | undefined;
  const assetWhere = async () => ({ id: allocation.assetId!, tenantId, workspaceId, AND: [await assetVisibility(allocation.assetId!)] });
  const assetSelect = { id: true, tenantId: true, workspaceId: true, itemGroupId: true, updatedAt: true,
    itemGroup: { select: { id: true, tenantId: true, workspaceId: true, updatedAt: true } } } as const;
  if (!allocation.assetId) {
    result.missingAssetReason = "asset_reference_missing"; result.missingPickupReason = "asset_reference_missing";
  } else {
    if (allocation.quantity !== 1 || !text(allocation.itemGroupId)) throw invalid();
    assetBefore = await prisma.rentalAsset.findFirst({ where: await assetWhere(), select: assetSelect });
    if (!assetBefore) result.missingAssetReason = "asset_not_visible_or_missing";
    else {
      if (assetBefore.id !== allocation.assetId || assetBefore.tenantId !== tenantId || assetBefore.workspaceId !== workspaceId
        || assetBefore.itemGroupId !== allocation.itemGroupId || !date(assetBefore.updatedAt)
        || !assetBefore.itemGroup || assetBefore.itemGroup.id !== allocation.itemGroupId || assetBefore.itemGroup.tenantId !== tenantId
        || assetBefore.itemGroup.workspaceId !== workspaceId || !date(assetBefore.itemGroup.updatedAt)) throw invalid();
      assetTimes = { asset: assetBefore.updatedAt.getTime(), itemGroup: assetBefore.itemGroup.updatedAt.getTime() };
      const assets = await prisma.$queryRaw<Array<{ id: string; tenantId: string; workspaceId: string; itemGroupId: string;
        updatedAt: Date; serialNo: string | null; attributes: unknown; itemGroupAttributes: unknown }>>(Prisma.sql`
        SELECT a.id, a.tenantId, a.workspaceId, a.itemGroupId, a.updatedAt, LEFT(a.serialNo, 192) AS serialNo,
          ${bounded(Prisma.sql`a.attributes`, "OBJECT")} AS attributes,
          ${bounded(Prisma.sql`g.attributes`, "OBJECT")} AS itemGroupAttributes
        FROM rental_assets a JOIN rental_item_groups g ON g.id = a.itemGroupId AND g.tenantId = a.tenantId AND g.workspaceId = a.workspaceId
        WHERE a.id = ${allocation.assetId} AND a.tenantId = ${tenantId} AND a.workspaceId = ${workspaceId}
          AND a.updatedAt = ${assetBefore.updatedAt} AND g.updatedAt = ${assetBefore.itemGroup.updatedAt} LIMIT 1`);
      const asset = assets[0];
      if (assets.length !== 1 || asset.id !== allocation.assetId || asset.tenantId !== tenantId || asset.workspaceId !== workspaceId
        || asset.itemGroupId !== allocation.itemGroupId || !date(asset.updatedAt) || asset.updatedAt.getTime() !== assetBefore.updatedAt.getTime()
        || asset.serialNo !== null && !text(asset.serialNo)) throw invalid();
      const attributes = parse(asset.attributes), groupAttributes = parse(asset.itemGroupAttributes);
      if (!object(attributes) || !object(groupAttributes)) {
        throw new ServiceUnavailableException("单资产资料不可用或超过读取上限");
      }
      result.asset = { id: asset.id, itemGroupId: asset.itemGroupId, serialNo: asset.serialNo ?? undefined,
        updatedAt: asset.updatedAt.toISOString(), attributes: attributes as Record<string, unknown>, itemGroupAttributes: groupAttributes as Record<string, unknown> };
    }
    type Pickup = { id: string; tenantId: string; workspaceId: string; orderId: string; templateId: string; templateCode: string;
      templateVersion: string; createdAt: Date; updatedAt: Date; revision: number | bigint; exchangeId: unknown;
      pickupItems: unknown; readings: unknown; corrections: unknown };
    const pickups = await prisma.$queryRaw<Pickup[]>(Prisma.sql`SELECT i.id, i.tenantId, i.workspaceId, i.orderId,
      i.templateId, i.templateCode, i.templateVersion, i.createdAt, i.updatedAt, i.revision,
      JSON_UNQUOTE(JSON_EXTRACT(i.results, '$."__r1InspectionMeta".exchangeId')) AS exchangeId,
      ${bounded(Prisma.sql`JSON_EXTRACT(i.results, '$."__r1InspectionMeta".pickupItems')`, "ARRAY", 200)} AS pickupItems,
      ${bounded(Prisma.sql`JSON_EXTRACT(i.results, '$."__r1InspectionMeta".usageReadings')`, "ARRAY", READING_LIMIT)} AS readings,
      ${bounded(Prisma.sql`JSON_EXTRACT(i.results, '$."__r1InspectionMeta".usageCorrections')`, "ARRAY", READING_LIMIT)} AS corrections
      FROM rental_inspection_records i JOIN rental_orders o ON o.id = i.orderId AND o.tenantId = i.tenantId AND o.workspaceId = i.workspaceId
      WHERE i.tenantId = ${tenantId} AND i.workspaceId = ${workspaceId} AND i.orderId = ${orderId} AND i.stage = 'pickup'
        AND o.updatedAt = ${parent.updatedAt}
        AND JSON_CONTAINS(JSON_EXTRACT(i.results, '$."__r1InspectionMeta".pickupItems'), JSON_OBJECT('allocationId', ${allocationId}))
      ORDER BY i.createdAt, i.id LIMIT 2`);
    if (pickups.length > 1) throw new ConflictException("原分配项领取依据不唯一");
    const pickup = pickups[0];
    if (!pickup) result.missingPickupReason = "allocation_pickup_binding_not_recorded";
    else {
      const revision = typeof pickup.revision === "number" || typeof pickup.revision === "bigint" ? Number(pickup.revision) : NaN;
      if (pickup.tenantId !== tenantId || pickup.workspaceId !== workspaceId || pickup.orderId !== orderId
        || !text(pickup.id) || !text(pickup.templateId) || !text(pickup.templateCode) || !text(pickup.templateVersion)
        || !date(pickup.createdAt) || !date(pickup.updatedAt) || !Number.isSafeInteger(revision) || revision < 1 || revision > 4294967295
        || (pickup.exchangeId ?? undefined) !== exchangeId) throw invalid();
      const items = parse(pickup.pickupItems), readings = parse(pickup.readings) ?? [], corrections = parse(pickup.corrections) ?? [];
      if (!Array.isArray(items) || items.length > 200 || !Array.isArray(readings) || readings.length > READING_LIMIT
        || !Array.isArray(corrections) || corrections.length > READING_LIMIT) {
        throw new ServiceUnavailableException("原领取资源或计量投影不可用");
      }
      const matches = items.filter(item => item && typeof item === "object" && item.allocationId === allocationId);
      if (matches.length !== 1 || matches[0].itemGroupId !== allocation.itemGroupId || matches[0].assetId !== allocation.assetId
        || matches[0].quantity !== allocation.quantity) throw invalid();
      result.pickup = { id: pickup.id, revision, updatedAt: pickup.updatedAt.toISOString(), createdAt: pickup.createdAt.toISOString(),
        templateId: pickup.templateId, templateCode: pickup.templateCode, templateVersion: pickup.templateVersion, exchangeId,
        binding: { allocationId, itemGroupId: allocation.itemGroupId!, assetId: allocation.assetId, quantity: allocation.quantity },
        resourceCount: items.length, usageReadings: readings, usageCorrections: corrections };
      const root = exchangeId ? Prisma.sql`JSON_EXTRACT(c.diff, '$.exchange.executionBasis.inspectionTemplateSnapshots')`
        : Prisma.sql`CASE WHEN JSON_TYPE(o.inspectionTemplateSnapshots) IS NULL OR JSON_TYPE(o.inspectionTemplateSnapshots) = 'NULL'
            THEN q.inspectionTemplateSnapshots ELSE o.inspectionTemplateSnapshots END`;
      const templateSources = Prisma.sql`FROM rental_orders o LEFT JOIN rental_quotes q ON q.id = o.quoteId
        AND q.tenantId = o.tenantId AND q.workspaceId = o.workspaceId AND q.categoryCode = o.categoryCode
        AND q.categoryVersionId <=> o.categoryVersionId
        LEFT JOIN rental_order_changes c ON c.id = ${exchangeId ?? null} AND c.tenantId = o.tenantId AND c.workspaceId = o.workspaceId
          AND c.orderId = o.id AND c.type = 'post_pickup_exchange' AND c.status = 'applied'`;
      const roots = await prisma.$queryRaw<Array<{ rootType: string | null; rootCount: number | bigint | null }>>(Prisma.sql`
        SELECT JSON_TYPE(${root}) AS rootType, JSON_LENGTH(${root}) AS rootCount ${templateSources}
        WHERE o.id = ${orderId} AND o.tenantId = ${tenantId} AND o.workspaceId = ${workspaceId} AND o.updatedAt = ${parent.updatedAt} LIMIT 1`);
      if (roots.length !== 1) throw invalid();
      const rootCount = roots[0].rootCount === null ? undefined : Number(roots[0].rootCount);
      if (roots[0].rootType !== null && roots[0].rootType !== "NULL" && (roots[0].rootType !== "ARRAY"
        || !Number.isSafeInteger(rootCount) || rootCount! < 0 || rootCount! > 200)) {
        throw new ServiceUnavailableException("原领取检查模板来源不可用或超过上限");
      }
      const templates = await prisma.$queryRaw<Array<{ fields: unknown; tenantId: unknown; categoryCode: unknown; enabled: unknown;
        sourceValid: number | bigint | boolean }>>(Prisma.sql`SELECT
        ${bounded(Prisma.sql`JSON_EXTRACT(t.entry, '$.fields')`, "ARRAY", READING_LIMIT)} AS fields,
        LEFT(JSON_UNQUOTE(JSON_EXTRACT(t.entry, '$.tenantId')), 192) AS tenantId,
        LEFT(JSON_UNQUOTE(JSON_EXTRACT(t.entry, '$.categoryCode')), 192) AS categoryCode,
        JSON_EXTRACT(t.entry, '$.enabled') AS enabled,
        (JSON_TYPE(t.entry) = 'OBJECT' AND JSON_TYPE(JSON_EXTRACT(t.entry, '$.id')) = 'STRING'
          AND JSON_TYPE(JSON_EXTRACT(t.entry, '$.tenantId')) = 'STRING' AND JSON_TYPE(JSON_EXTRACT(t.entry, '$.categoryCode')) = 'STRING'
          AND JSON_TYPE(JSON_EXTRACT(t.entry, '$.code')) = 'STRING' AND JSON_TYPE(JSON_EXTRACT(t.entry, '$.version')) = 'STRING'
          AND JSON_TYPE(JSON_EXTRACT(t.entry, '$.stage')) = 'STRING' AND JSON_TYPE(JSON_EXTRACT(t.entry, '$.enabled')) = 'BOOLEAN') AS sourceValid
        ${templateSources}
        JOIN JSON_TABLE(CASE WHEN JSON_TYPE(${root}) = 'ARRAY' AND JSON_LENGTH(${root}) <= 200 THEN ${root} ELSE JSON_ARRAY() END,
          '$[*]' COLUMNS(entry JSON PATH '$')) t
        WHERE o.id = ${orderId} AND o.tenantId = ${tenantId} AND o.workspaceId = ${workspaceId} AND o.updatedAt = ${parent.updatedAt}
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.entry, '$.sourceTemplateId')), JSON_UNQUOTE(JSON_EXTRACT(t.entry, '$.id'))) = ${pickup.templateId}
          AND JSON_UNQUOTE(JSON_EXTRACT(t.entry, '$.code')) = ${pickup.templateCode}
          AND JSON_UNQUOTE(JSON_EXTRACT(t.entry, '$.version')) = ${pickup.templateVersion}
          AND JSON_UNQUOTE(JSON_EXTRACT(t.entry, '$.stage')) = 'pickup' LIMIT 2`);
      if (templates.length > 1) throw invalid();
      if (templates.length) {
        const frozen = templates[0], fields = parse(frozen.fields);
        if (![true, 1, 1n].includes(frozen.sourceValid) || frozen.tenantId !== tenantId || typeof frozen.categoryCode !== "string"
          || readRentalCategoryCode(frozen.categoryCode) !== readRentalCategoryCode(parent.categoryCode) || frozen.enabled !== true) throw invalid();
        if (!Array.isArray(fields) || fields.length > READING_LIMIT) throw new ServiceUnavailableException("原计量字段或单位不可用");
        result.pickup.fields = fields;
        const codes = frozenUsageFields(fields).map(field => field.code);
        if (codes.length) {
          // Read only these frozen numeric fields from the original results.
          // Current effective readings/corrections never overwrite this source.
          const values = Prisma.sql`JSON_OBJECT(${Prisma.join(codes.flatMap(code => {
            const value = Prisma.sql`JSON_EXTRACT(i.results, ${`$.${JSON.stringify(code)}`})`;
            return [Prisma.sql`${code}`, Prisma.sql`CASE WHEN JSON_TYPE(${value}) IS NULL OR JSON_TYPE(${value}) = 'NULL' THEN NULL
              WHEN JSON_TYPE(${value}) IN ('INTEGER', 'DOUBLE', 'STRING') AND OCTET_LENGTH(CAST(${value} AS CHAR)) <= 1000 THEN ${value}
              ELSE JSON_OBJECT('readLimitExceeded', TRUE) END`];
          }))})`;
          const originals = await prisma.$queryRaw<Array<{ originalReadings: unknown }>>(Prisma.sql`
            SELECT ${bounded(values, "OBJECT")} AS originalReadings FROM rental_inspection_records i
            WHERE i.id = ${pickup.id} AND i.tenantId = ${tenantId} AND i.workspaceId = ${workspaceId} AND i.orderId = ${orderId}
              AND i.stage = 'pickup' AND i.revision = ${revision} AND i.updatedAt = ${pickup.updatedAt} LIMIT 1`);
          const originalsValue = originals.length === 1 ? parse(originals[0].originalReadings) : undefined;
          if (!object(originalsValue)) throw invalid();
          result.pickup.originalReadings = originalsValue;
        }
      }
      const latest = await prisma.rentalInspectionRecord.findFirst({ where: { id: pickup.id, tenantId, workspaceId, orderId, stage: "pickup" },
        select: { revision: true, updatedAt: true } });
      if (!latest || latest.revision !== revision || !date(latest.updatedAt) || latest.updatedAt.getTime() !== pickup.updatedAt.getTime()) throw invalid();
    }
  }
  const after = await prisma.rentalOrder.findFirst({ where: parentWhere(), select: parentSelect });
  const allocationAfter = await prisma.rentalAllocation.findFirst({ where: allocationWhere(), select: allocationSelect });
  // The original idempotency fingerprint intentionally has no Date encoding.
  // These read fences compare captured milliseconds, leaving old keys intact.
  if (!after || !allocationAfter || !date(after.updatedAt) || after.updatedAt.getTime() !== sourceOrderTime
    || !date(allocationAfter.updatedAt) || allocationAfter.updatedAt.getTime() !== sourceAllocationTime
    || requestFingerprint(after) !== requestFingerprint(parent)
    || requestFingerprint(allocationAfter) !== requestFingerprint(allocation) || requestFingerprint(getRequestIdentity()) !== identityHash
    || await resolveScopeWorkspaceId(prisma, tenantId) !== workspaceId) throw invalid();
  if (allocation.assetId) {
    const assetAfter = await prisma.rentalAsset.findFirst({ where: await assetWhere(), select: assetSelect });
    if (assetBefore && (!assetAfter || !assetTimes || !date(assetAfter.updatedAt)
      || assetAfter.updatedAt.getTime() !== assetTimes.asset || !assetAfter.itemGroup || !date(assetAfter.itemGroup.updatedAt)
      || assetAfter.itemGroup.updatedAt.getTime() !== assetTimes.itemGroup)) throw invalid();
    if (requestFingerprint(assetAfter) !== requestFingerprint(assetBefore)) throw invalid();
  }
  if (requestFingerprint(getRequestIdentity()) !== identityHash) throw new ForbiddenException("领取资源读取期间当前身份变化");
  return result;
}
