/** Bounded, read-only transport of order/exchange frozen inspection references.
 * Parent visibility and before/after versions are mandatory. No current catalog,
 * full JSON, inspection results, asset identity, prices or business writes. */
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RentalAllocation, RentalInspectionTemplateRef, RentalOrderInspectionBasisFacts } from "@rental-os/shared";
import type { PrismaService } from "../database/prisma.service";
import { getRequestIdentity } from "../../common/request-identity";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { requestFingerprint } from "./rental-idempotency.repository";

export type RentalOrderInspectionBasisInput = Omit<RentalOrderInspectionBasisFacts,
  "contractVersion" | "applicableTemplateRefs" | "recordResourceCoverage" | "semantics">;

type TemplateProjection = { templatesType: string | null; templateCount: bigint | number | null; templates: unknown };
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 192;
const invalid = () => new ConflictException("冻结检查依据格式或来源绑定无效");

// JSON paths and identifiers are source constants; values use Prisma parameters.
// Extract only the reference whitelist inside MySQL, never fetch then slice JSON.
function stringRef(value: Prisma.Sql, key: string): Prisma.Sql {
  return Prisma.sql`CASE WHEN JSON_TYPE(JSON_EXTRACT(${value}, ${key})) = 'STRING'
    AND CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(${value}, ${key}))) BETWEEN 1 AND 192
    THEN JSON_UNQUOTE(JSON_EXTRACT(${value}, ${key})) ELSE NULL END`;
}
function templateProjection(value: Prisma.Sql): Prisma.Sql {
  const entry = Prisma.sql`j.entry`;
  return Prisma.sql`JSON_TYPE(${value}) AS templatesType, JSON_LENGTH(${value}) AS templateCount,
    (SELECT JSON_ARRAYAGG(JSON_OBJECT('ordinality', j.ordinality,
      'id', ${stringRef(entry, '$.id')}, 'tenantId', ${stringRef(entry, '$.tenantId')},
      'code', ${stringRef(entry, '$.code')}, 'stage', ${stringRef(entry, '$.stage')},
      'version', ${stringRef(entry, '$.version')},
      'enabled', CASE WHEN JSON_TYPE(JSON_EXTRACT(j.entry, '$.enabled')) = 'BOOLEAN'
        THEN JSON_EXTRACT(j.entry, '$.enabled') ELSE NULL END))
      FROM JSON_TABLE(CASE WHEN JSON_TYPE(${value}) = 'ARRAY' AND JSON_LENGTH(${value}) <= 50
        THEN ${value} ELSE JSON_ARRAY() END, '$[*]' COLUMNS(ordinality FOR ORDINALITY, entry JSON PATH '$')) AS j) AS templates`;
}
function parseTemplates(row: TemplateProjection, tenantId: string): RentalInspectionTemplateRef[] | undefined {
  if (row.templatesType === null || row.templatesType === 'NULL') return undefined;
  if (row.templatesType !== 'ARRAY') throw invalid();
  const count = Number(row.templateCount);
  if (!Number.isSafeInteger(count) || count < 0 || count > 50) throw new ServiceUnavailableException("冻结检查模板超过只读上限");
  const values = count === 0 ? [] : row.templates;
  if (!Array.isArray(values) || values.length !== count) throw invalid();
  const ids = new Set<string>();
  const result = values.map(value => {
    if (!value || typeof value !== 'object') throw invalid();
    const row = value as Record<string, unknown>;
    if (!Number.isSafeInteger(row.ordinality) || Number(row.ordinality) < 1 || Number(row.ordinality) > count
      || !text(row.id) || !text(row.tenantId) || row.tenantId !== tenantId || !text(row.code)
      || !text(row.version) || (row.stage !== 'pickup' && row.stage !== 'return') || typeof row.enabled !== 'boolean'
      || ids.has(row.id)) throw invalid();
    ids.add(row.id);
    return { ordinality: Number(row.ordinality), ref: { id: row.id, tenantId: row.tenantId, code: row.code,
      stage: row.stage, version: row.version, enabled: row.enabled } satisfies RentalInspectionTemplateRef };
  }).sort((a, b) => a.ordinality - b.ordinality);
  if (result.some((row, index) => row.ordinality !== index + 1)) throw invalid();
  return result.map(row => row.ref);
}

export async function readOrderInspectionBasisInput(prisma: PrismaService, tenantId: string, workspaceId: string,
  orderId: string, visibility: () => Prisma.RentalOrderWhereInput): Promise<RentalOrderInspectionBasisInput> {
  const current = getRequestIdentity();
  if (!current?.userId || current.isSaasAdmin || current.tenantId !== tenantId || current.workspaceId !== workspaceId)
    throw new ForbiddenException("检查依据缺少当前租户及空间");
  const identity = requestFingerprint(current);
  if (await resolveScopeWorkspaceId(prisma, tenantId) !== workspaceId) throw new ForbiddenException("检查依据空间变化");
  const where = () => ({ id: orderId, tenantId, workspaceId, ...visibility() });
  const before = await prisma.rentalOrder.findFirst({ where: where(), select: { id: true, updatedAt: true } });
  if (!before) throw new NotFoundException("检查依据关联订单不可读");
  const rows = await prisma.rentalAllocation.findMany({ where: { orderId, order: where() }, take: 201,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, orderId: true, orderLineId: true, orderLine: { select: { orderId: true } }, itemGroupId: true, status: true, quantity: true, updatedAt: true } });
  if (rows.length > 200) throw new ServiceUnavailableException("检查依据分配人口超过只读上限");
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => !text(row.id) || row.orderId !== orderId
    || !text(row.orderLineId) || row.orderLine.orderId !== orderId || (row.itemGroupId !== null && !text(row.itemGroupId))
    || !['pre_assigned', 'locked', 'allocated', 'picked_up', 'consumed', 'returned', 'released'].includes(row.status)
    || !Number.isSafeInteger(row.quantity) || row.quantity < 1)) throw invalid();
  const originals = await prisma.$queryRaw<TemplateProjection[]>(Prisma.sql`SELECT ${templateProjection(Prisma.sql`o.inspectionTemplateSnapshots`)}
    FROM rental_orders o WHERE o.id = ${orderId} AND o.tenantId = ${tenantId} AND o.workspaceId = ${workspaceId}
      AND o.updatedAt = ${before.updatedAt} LIMIT 1`);
  if (originals.length !== 1) throw invalid();
  const originalTemplateRefs = parseTemplates(originals[0], tenantId);
  if (!originalTemplateRefs) throw new ServiceUnavailableException("订单缺少冻结检查模板，不能套用当前配置");
  const metadata = rows.length ? await prisma.$queryRaw<Array<{ id: string; updatedAt: Date;
    metadataType: string | null; exchangeType: string | null; exchangeId: unknown }>>(Prisma.sql`
    SELECT a.id, a.updatedAt, JSON_TYPE(a.metadata) AS metadataType,
      JSON_TYPE(JSON_EXTRACT(a.metadata, '$.exchangeId')) AS exchangeType,
      ${stringRef(Prisma.sql`a.metadata`, '$.exchangeId')} AS exchangeId
    FROM rental_allocations a JOIN rental_orders o ON o.id = a.orderId
    WHERE a.orderId = ${orderId} AND a.id IN (${Prisma.join(rows.map(row => row.id))})
      AND o.tenantId = ${tenantId} AND o.workspaceId = ${workspaceId} AND o.updatedAt = ${before.updatedAt} LIMIT 201`) : [];
  if (metadata.length !== rows.length || new Set(metadata.map(row => row.id)).size !== rows.length) throw invalid();
  const allocations: RentalOrderInspectionBasisInput['allocations'] = rows.map(row => {
    const source = metadata.find(value => value.id === row.id);
    if (!source || source.updatedAt.getTime() !== row.updatedAt.getTime()
      || (source.metadataType !== null && source.metadataType !== 'NULL' && source.metadataType !== 'OBJECT')) throw invalid();
    // An absent link is legacy absence. Null, malformed or truncated links must
    // not silently reclassify replacement goods as original goods.
    if (source.exchangeType !== null && (source.exchangeType !== 'STRING' || !text(source.exchangeId))) throw invalid();
    return { id: row.id, orderLineId: row.orderLineId, itemGroupId: row.itemGroupId ?? undefined,
      status: row.status as RentalAllocation['status'], quantity: row.quantity,
      ...(source.exchangeType === 'STRING' ? { exchangeId: source.exchangeId as string } : {}) };
  });
  const exchangeIds = [...new Set(allocations.flatMap(row => row.exchangeId ? [row.exchangeId] : []))];
  if (exchangeIds.length > 50) throw new ServiceUnavailableException("检查依据换货关联超过只读上限");
  const changes = exchangeIds.length ? await prisma.$queryRaw<Array<TemplateProjection & { id: string; type: string; status: string }>>(Prisma.sql`
    SELECT c.id, c.type, c.status, ${templateProjection(Prisma.sql`JSON_EXTRACT(c.diff, '$.exchange.executionBasis.inspectionTemplateSnapshots')`)}
    FROM rental_order_changes c JOIN rental_orders o ON o.id = c.orderId
    WHERE c.tenantId = ${tenantId} AND c.workspaceId = ${workspaceId} AND c.orderId = ${orderId}
      AND c.id IN (${Prisma.join(exchangeIds)}) AND c.type = 'post_pickup_exchange' AND c.status = 'applied'
      AND o.tenantId = ${tenantId} AND o.workspaceId = ${workspaceId} AND o.updatedAt = ${before.updatedAt}
    ORDER BY c.sequence, c.id LIMIT 51`) : [];
  if (changes.length > 50 || new Set(changes.map(row => row.id)).size !== changes.length) throw invalid();
  const exchanges = changes.map(row => {
    if (!text(row.id) || !exchangeIds.includes(row.id) || row.type !== 'post_pickup_exchange' || row.status !== 'applied') throw invalid();
    return { id: row.id, type: 'post_pickup_exchange' as const, status: 'applied' as const, templateRefs: parseTemplates(row, tenantId) };
  });
  const afterRows = await prisma.rentalAllocation.findMany({ where: { orderId, order: where() }, take: 201,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, orderId: true, orderLineId: true, orderLine: { select: { orderId: true } }, itemGroupId: true, status: true, quantity: true, updatedAt: true } });
  const after = await prisma.rentalOrder.findFirst({ where: where(), select: { id: true, updatedAt: true } });
  if (!after || after.updatedAt.getTime() !== before.updatedAt.getTime() || requestFingerprint(rows) !== requestFingerprint(afterRows)
    || await resolveScopeWorkspaceId(prisma, tenantId) !== workspaceId || requestFingerprint(getRequestIdentity()) !== identity)
    throw new ConflictException("检查依据读取期间订单、分配或授权变化");
  return { orderId, tenantId, workspaceId, sourceOrderUpdatedAt: before.updatedAt.toISOString(), originalTemplateRefs, allocations, exchanges };
}
