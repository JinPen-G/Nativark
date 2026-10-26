/** Reopens conditions from the original audit, never stored catalog bodies or a second chat/history database. */
import type { PrismaClient } from '@prisma/client';
import { parseRentalDesktopCatalogSource, type RentalDesktopBusinessBinding, type RentalDesktopCatalogSource,
  type RentalDesktopCatalogSourceRef } from '@rental-os/shared';
import { DesktopBusinessError } from './desktop-business.error';

type SourceRow = { id: string; tenantId: string; workspaceId: string | null; userId: string | null; action: string; detail: unknown; createdAt: Date };
const action = 'ai.desktop.catalog.preview';
const select = { id: true, tenantId: true, workspaceId: true, userId: true, action: true, detail: true, createdAt: true } as const;
const unavailable = () => new DesktopBusinessError('AI_RESOURCE_UNAVAILABLE');
function bounds(binding: RentalDesktopBusinessBinding, now: Date) {
  if (!Number.isFinite(now.getTime())) throw unavailable();
  return { tenantId: binding.tenantId, workspaceId: binding.workspaceId, userId: binding.actorId, action,
    createdAt: { gte: new Date(now.getTime() - 30 * 86400000), lte: now } };
}
function read(row: SourceRow, binding: RentalDesktopBusinessBinding, accessHash: string, now: Date): RentalDesktopCatalogSource {
  if (row.tenantId !== binding.tenantId || row.workspaceId !== binding.workspaceId || row.userId !== binding.actorId || row.action !== action
    || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())
    || row.createdAt > now || row.createdAt.getTime() < now.getTime() - 30 * 86400000) throw unavailable();
  const absent = (): RentalDesktopCatalogSource => parseRentalDesktopCatalogSource({ state: 'unavailable', auditId: row.id, observedAt: row.createdAt.toISOString() });
  try {
    const detail = row.detail;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail) || !('targetType' in detail) || detail.targetType !== 'rental.catalog.search'
      || !('targetId' in detail) || typeof detail.targetId !== 'string' || !('metadata' in detail)) return absent();
    const metadata = detail.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !('catalogSource' in metadata)) return absent();
    const source = metadata.catalogSource;
    if (!source || typeof source !== 'object' || Array.isArray(source) || !('accessHash' in source) || source.accessHash !== accessHash
      || !('version' in source) || source.version !== 1 || !('reference' in source)) return absent();
    const parsed = parseRentalDesktopCatalogSource({ ...(source.reference as object), auditId: row.id });
    if (parsed.state !== 'reference' || parsed.requestId !== detail.targetId || Date.parse(parsed.observedAt) > row.createdAt.getTime()
      || Date.parse(parsed.sourceExpiresAt) <= now.getTime()) return absent();
    return parsed;
  } catch { return absent(); } // Legacy/malformed references never recover a body or become authorization.
}

export class PrismaDesktopCatalogSourceRepository {
  constructor(private readonly db: Pick<PrismaClient, 'operationLog'>) {}
  /** Scope/actor-filtered, ordered, at most limit+1 rows over existing audit indexes; no global scan or business bodies. */
  async list(value: RentalDesktopBusinessBinding, limit: number, hash: string, time: Date) {
    const binding = structuredClone(value), now = new Date(time);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10 || !/^[a-f0-9]{64}$/u.test(hash)) throw unavailable();
    const rows = structuredClone(await this.db.operationLog.findMany({ where: bounds(binding, now), select,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 }));
    if (rows.length > limit + 1 || new Set(rows.map(row => row.id)).size !== rows.length) throw unavailable();
    // Validate the probe row too; never conceal a foreign row by truncating it first.
    const items = rows.map(row => read(row, binding, hash, now));
    return { items: items.slice(0, limit), truncated: items.length > limit };
  }
  /** Exact original audit ID under current scope and actor; absence cannot prove an old operation never happened. */
  async resolve(value: RentalDesktopBusinessBinding, reference: RentalDesktopCatalogSourceRef, hash: string, time: Date) {
    const binding = structuredClone(value), ref = structuredClone(reference), now = new Date(time);
    const row = structuredClone(await this.db.operationLog.findFirst({ where: { ...bounds(binding, now), id: ref.auditId }, select }));
    if (!row) throw unavailable();
    const source = read(row, binding, hash, now);
    if (source.state !== 'reference' || source.requestId !== ref.requestId) throw unavailable();
    return source;
  }
  /** Resolve the exact preview request, not the most recent audit. Duplicate records cannot establish one observation. */
  async preview(value: RentalDesktopBusinessBinding, requestId: string, hash: string, time: Date) {
    const binding = structuredClone(value), now = new Date(time);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(requestId) || !/^[a-f0-9]{64}$/u.test(hash)) throw unavailable();
    const rows = structuredClone(await this.db.operationLog.findMany({ where: { ...bounds(binding, now),
      detail: { path: '$.targetId', equals: requestId } }, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 2 }));
    if (rows.length !== 1) throw unavailable();
    const source = read(rows[0]!, binding, hash, now);
    if (source.state !== 'reference' || source.requestId !== requestId || now.getTime() >= Date.parse(source.observedAt) + 30000) throw unavailable();
    const detail = rows[0]!.detail;
    const metadata = detail && typeof detail === 'object' && !Array.isArray(detail) && 'metadata' in detail ? detail.metadata : undefined;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !('rowCount' in metadata) || !('truncated' in metadata)
      || typeof metadata.rowCount !== 'number' || !Number.isInteger(metadata.rowCount) || metadata.rowCount < 0
      || metadata.rowCount > source.query.limit || typeof metadata.truncated !== 'boolean'
      || (metadata.truncated && metadata.rowCount !== source.query.limit)) throw unavailable();
    return { ...source, rowCount: metadata.rowCount, truncated: metadata.truncated };
  }
}
