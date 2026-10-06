import { randomUUID } from 'node:crypto';
import type { AiExecutionScope, AiKnowledgeChunkDraft } from '@rental-os/shared';
import type { KnowledgeOperation, KnowledgeRecord, KnowledgeRepositoryPort } from './knowledge.ports';
import { KnowledgeError } from './knowledge-errors';
import { sameScope, scopeSchema } from './knowledge-validation';

type Delegate = {
  findFirst(args: unknown): Promise<unknown>;
  findUnique?(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
type KnowledgeTransaction = {
  aiKnowledgeDocument: Delegate;
  aiKnowledgeVersion: Delegate & { findFirst(args: unknown): Promise<unknown> };
  aiKnowledgeChunk: Delegate;
  aiKnowledgeOperation: Delegate;
};
export interface KnowledgePrismaClient extends KnowledgeTransaction {
  $transaction<T>(callback: (transaction: KnowledgeTransaction) => Promise<T>, options?: { isolationLevel: 'Serializable'; maxWait: number; timeout: number }): Promise<T>;
}

const workspace = (scope: AiExecutionScope) => {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success || parsed.data.kind !== 'workspace') throw new KnowledgeError('unavailable');
  return parsed.data;
};
const columns = (scope: AiExecutionScope, documentId: string) => {
  const value = workspace(scope);
  return { tenantId: value.tenantId, workspaceId: value.workspaceId, id: documentId };
};
const json = (value: unknown): unknown => structuredClone(value);

/**
 * Prisma adapter for the formal knowledge ports. The draft is stored in the
 * server-owned JSON state column while relational scope/revision/status fields
 * remain queryable. Operation receipt and version/chunk creation share one
 * Prisma transaction; no in-memory map is used for CAS or replay.
 */
export class PrismaKnowledgeRepository implements KnowledgeRepositoryPort {
  constructor(private readonly db: KnowledgePrismaClient, private readonly clock: () => Date = () => new Date()) {
    for (const key of ['aiKnowledgeDocument', 'aiKnowledgeVersion', 'aiKnowledgeChunk', 'aiKnowledgeOperation']) {
      if (!db || typeof (db as unknown as Record<string, unknown>)[key] !== 'object') throw new KnowledgeError('unavailable');
    }
    if (typeof db.$transaction !== 'function') throw new KnowledgeError('unavailable');
  }

  async read(scope: AiExecutionScope, documentId: string): Promise<KnowledgeRecord | null> {
    const where = columns(scope, documentId);
    const row = await this.db.aiKnowledgeDocument.findFirst({ where, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { chunks: true } } } });
    if (!row) return null;
    const value = row as { state?: unknown; tenantId?: unknown; workspaceId?: unknown; id?: unknown };
    if (typeof value.state !== 'object' || value.state === null) throw new KnowledgeError('unavailable');
    const record = structuredClone(value.state) as KnowledgeRecord;
    if (!record.document || record.document.documentId !== documentId || !sameScope(record.document.scope, scope)
      || value.tenantId !== where.tenantId || value.workspaceId !== where.workspaceId || value.id !== documentId) throw new KnowledgeError('unavailable');
    return record;
  }

  async operation(scope: AiExecutionScope, documentId: string, operationId: string): Promise<KnowledgeOperation | null> {
    const value = workspace(scope);
    const row = await this.db.aiKnowledgeOperation.findFirst({ where: { tenantId: value.tenantId, workspaceId: value.workspaceId, documentId, operationId } });
    if (!row) return null;
    const record = row as { operationId?: unknown; fingerprint?: unknown; failure?: unknown };
    if (record.operationId !== operationId || typeof record.fingerprint !== 'string') throw new KnowledgeError('unavailable');
    return { id: operationId, fingerprint: record.fingerprint, ...(typeof record.failure === 'string' ? { failure: record.failure as KnowledgeOperation['failure'] } : {}) };
  }

  async commit(input: {
    scope: AiExecutionScope; documentId: string; expectedRevision: number;
    operation: KnowledgeOperation; next: KnowledgeRecord; chunks?: AiKnowledgeChunkDraft[]; newVersion: boolean;
  }): Promise<'committed' | 'conflict'> {
    input = structuredClone(input);
    const value = workspace(input.scope);
    if (input.next.document.documentId !== input.documentId || !sameScope(input.next.document.scope, input.scope)) throw new KnowledgeError('conflict');
    try {
      return await this.db.$transaction(async transaction => {
        const operation = await transaction.aiKnowledgeOperation.findFirst({ where: { tenantId: value.tenantId, workspaceId: value.workspaceId, documentId: input.documentId, operationId: input.operation.id } });
        if (operation) return (operation as { fingerprint?: unknown }).fingerprint === input.operation.fingerprint ? 'committed' : 'conflict';
        const existing = await transaction.aiKnowledgeDocument.findFirst({ where: { ...columns(input.scope, input.documentId) }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
        const currentRevision = existing ? Number((existing as { revision?: unknown }).revision) : 0;
        if (!Number.isSafeInteger(currentRevision) || currentRevision !== input.expectedRevision || input.next.revision !== currentRevision + 1) return 'conflict';
        const now = this.clock();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new KnowledgeError('unavailable');
        const documentData = { tenantId: value.tenantId, workspaceId: value.workspaceId, title: input.next.document.title,
          status: input.next.document.publication, revision: input.next.revision, withdrawnAt: input.next.document.publication === 'withdrawn' ? now : null,
          state: json(input.next) };
        if (!existing) await transaction.aiKnowledgeDocument.create({ data: { id: input.documentId, ...documentData } });
        else {
          const changed = await transaction.aiKnowledgeDocument.updateMany({ where: { ...columns(input.scope, input.documentId), revision: input.expectedRevision }, data: documentData });
          if (changed.count !== 1) throw new KnowledgeError('conflict');
        }
        if (input.newVersion) {
          const latest = existing as { versions?: Array<{ version?: unknown }> } | null;
          const nextVersion = Number(latest?.versions?.[0]?.version ?? 0) + 1;
          const chunks = input.chunks ?? [];
          await transaction.aiKnowledgeVersion.create({ data: { id: randomUUID(), documentId: input.documentId, version: nextVersion, status: input.next.document.publication, contentHash: input.next.document.documentVersion, chunks: { create: chunks.map((chunk, index) => ({ id: randomUUID(), chunkIndex: index, text: chunk.text, tokenCount: chunk.text.length, state: json(chunk) })) } } });
        }
        await transaction.aiKnowledgeOperation.create({ data: { id: randomUUID(), documentId: input.documentId, tenantId: value.tenantId, workspaceId: value.workspaceId, operationId: input.operation.id, fingerprint: input.operation.fingerprint, ...(input.operation.failure ? { failure: input.operation.failure } : {}) } });
        return 'committed';
      }, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof KnowledgeError) throw error;
      return 'conflict';
    }
  }
}
