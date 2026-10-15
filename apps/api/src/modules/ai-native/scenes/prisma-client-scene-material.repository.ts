import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const rowSchema = z.object({ id: z.string().uuid(), tenantId: id, workspaceId: id,
  channel: z.enum(['wechat_miniprogram', 'app', 'web']), principalKind: z.enum(['personal', 'corporate']),
  principalHash: hash, bindingHash: hash, publicationHash: hash, operationKey: id, inputHash: hash, materialHash: hash,
  command: z.unknown(), material: z.unknown(), publication: z.unknown(), revision: z.literal(1),
  createdAt: z.date(), expiresAt: z.date() }).strict();
export type AiClientSceneMaterial = z.infer<typeof rowSchema>;
export type AiClientMaterialScope = Pick<AiClientSceneMaterial, 'tenantId' | 'workspaceId' | 'channel' | 'principalHash' | 'principalKind'>;
export type AiClientMaterialDb = Pick<PrismaClient, '$transaction' | '$queryRaw' | '$executeRaw' | 'tenant' | 'businessWorkspace'>;
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;

export class AiClientMaterialError extends Error {
  readonly retryable = false;
  constructor(readonly code: 'AI_CLIENT_RESULT_UNKNOWN' | 'AI_CLIENT_REVISION_CONFLICT' | 'AI_CLIENT_STORAGE_UNAVAILABLE' | 'AI_CLIENT_RESOURCE_ERASED') { super(code); }
  get nextAction() { return this.code === 'AI_CLIENT_RESULT_UNKNOWN' ? 'readOperation' : 'manual_review'; }
}

export class PrismaClientSceneMaterialRepository {
  constructor(private readonly db: AiClientMaterialDb) {
    if (typeof db?.$queryRaw !== 'function' || typeof db.$executeRaw !== 'function' || typeof db.$transaction !== 'function'
      || typeof db.tenant?.findFirst !== 'function' || typeof db.businessWorkspace?.findFirst !== 'function') {
      throw new AiClientMaterialError('AI_CLIENT_STORAGE_UNAVAILABLE');
    }
  }

  async resolveScope(tenantCode: string, serviceCode: string) {
    const tenant = await this.db.tenant.findFirst({ where: { code: tenantCode, status: 'ACTIVE' }, select: { id: true } });
    if (!tenant) throw new AiClientMaterialError('AI_CLIENT_STORAGE_UNAVAILABLE');
    const workspace = await this.db.businessWorkspace.findFirst({ where: { tenantId: tenant.id, code: serviceCode, status: 'ACTIVE',
      clientChannelPublications: { some: { tenantId: tenant.id, enabled: true } } }, select: { id: true } });
    if (!workspace) throw new AiClientMaterialError('AI_CLIENT_STORAGE_UNAVAILABLE');
    return { tenantId: tenant.id, workspaceId: workspace.id };
  }

  private decode(value: unknown, scope: AiClientMaterialScope) {
    const { erasedAt, ...stored } = z.object({ erasedAt: z.date().nullable().optional() }).passthrough().parse(value);
    if (erasedAt) throw new AiClientMaterialError('AI_CLIENT_RESOURCE_ERASED');
    const row = rowSchema.parse(stored);
    if (row.expiresAt <= row.createdAt || (['tenantId', 'workspaceId', 'channel', 'principalHash', 'principalKind'] as const)
      .some(key => row[key] !== scope[key])
      || Buffer.byteLength(JSON.stringify(row.command), 'utf8') > 2048
      || Buffer.byteLength(JSON.stringify(row.material), 'utf8') > 65536
      || Buffer.byteLength(JSON.stringify(row.publication), 'utf8') > 8192) throw new AiClientMaterialError('AI_CLIENT_STORAGE_UNAVAILABLE');
    return row;
  }

  private async load(reader: Reader, query: Prisma.Sql, scope: AiClientMaterialScope) {
    try {
      const rows = await reader.$queryRaw<unknown[]>(query);
      if (!Array.isArray(rows) || rows.length > 1) throw new AiClientMaterialError('AI_CLIENT_STORAGE_UNAVAILABLE');
      return rows.length ? this.decode(rows[0], scope) : null;
    } catch (error) {
      if (error instanceof AiClientMaterialError) throw error;
      throw new AiClientMaterialError('AI_CLIENT_STORAGE_UNAVAILABLE');
    }
  }

  async findOperation(scope: AiClientMaterialScope, operationKey: string, reader: Reader = this.db, locked = false) {
    const row = await this.load(reader, Prisma.sql`SELECT * FROM ai_client_scene_materials WHERE tenantId = ${scope.tenantId}
      AND workspaceId = ${scope.workspaceId} AND channel = ${scope.channel} AND principalHash = ${scope.principalHash}
      AND operationKey = ${operationKey} LIMIT 1 ${locked ? Prisma.sql`FOR UPDATE` : Prisma.empty}`, scope);
    if (!row) return null;
    if (row.operationKey !== operationKey) throw new AiClientMaterialError('AI_CLIENT_STORAGE_UNAVAILABLE');
    return row;
  }

  async findSource(scope: AiClientMaterialScope, materialRef: string) {
    const row = await this.load(this.db, Prisma.sql`SELECT * FROM ai_client_scene_materials WHERE tenantId = ${scope.tenantId}
      AND workspaceId = ${scope.workspaceId} AND channel = ${scope.channel} AND principalHash = ${scope.principalHash}
      AND id = ${materialRef} LIMIT 1`, scope);
    if (!row) return null;
    if (row.id !== materialRef) throw new AiClientMaterialError('AI_CLIENT_STORAGE_UNAVAILABLE');
    return row;
  }

  async save(value: AiClientSceneMaterial) {
    const row = this.decode(structuredClone(value), value);
    let attempted = false;
    try {
      return await this.db.$transaction(async tx => {
        const existing = await this.findOperation(row, row.operationKey, tx, true);
        if (existing) {
          if (existing.inputHash !== row.inputHash) throw new AiClientMaterialError('AI_CLIENT_REVISION_CONFLICT');
          return { row: existing, replayed: true };
        }
        attempted = true;
        await tx.$executeRaw(Prisma.sql`INSERT INTO ai_client_scene_materials
          (id, tenantId, workspaceId, channel, principalKind, principalHash, bindingHash, publicationHash, operationKey,
           inputHash, materialHash, command, material, publication, revision, createdAt, expiresAt)
          VALUES (${row.id}, ${row.tenantId}, ${row.workspaceId}, ${row.channel}, ${row.principalKind}, ${row.principalHash},
            ${row.bindingHash}, ${row.publicationHash}, ${row.operationKey}, ${row.inputHash}, ${row.materialHash},
            ${JSON.stringify(row.command)}, ${JSON.stringify(row.material)}, ${JSON.stringify(row.publication)},
            ${row.revision}, ${row.createdAt}, ${row.expiresAt})`);
        return { row, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiClientMaterialError) throw error;
      throw new AiClientMaterialError(attempted ? 'AI_CLIENT_RESULT_UNKNOWN' : 'AI_CLIENT_STORAGE_UNAVAILABLE');
    }
  }
}
