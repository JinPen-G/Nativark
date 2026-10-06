import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionScope, AiKnowledgeChunkDraft } from '@rental-os/shared';
import type { KnowledgeOperation, KnowledgeRecord, KnowledgeRepositoryPort } from './knowledge.ports';
import { KnowledgeCommitUnknownError, KnowledgeError, unavailable } from './knowledge-errors';
import { sameScope, scopeSchema, validateChunks } from './knowledge-validation';

export type KnowledgePrismaClient = Pick<PrismaClient, '$transaction' | 'aiKnowledgeDocument' | 'aiKnowledgeVersion' | 'aiKnowledgeChunk' | 'aiKnowledgeOperation'>;

const workspace = (scope: AiExecutionScope) => {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success || parsed.data.kind !== 'workspace') throw new KnowledgeError('unavailable');
  return parsed.data;
};
const columns = (scope: AiExecutionScope, documentId: string) => {
  const value = workspace(scope);
  return { tenantId: value.tenantId, workspaceId: value.workspaceId, id: documentId };
};
const json = (value: KnowledgeRecord | AiKnowledgeChunkDraft): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export class PrismaKnowledgeRepository implements KnowledgeRepositoryPort {
  constructor(private readonly db: KnowledgePrismaClient, private readonly clock: () => Date = () => new Date()) {
    for (const key of ['aiKnowledgeDocument', 'aiKnowledgeVersion', 'aiKnowledgeChunk', 'aiKnowledgeOperation'] as const) {
      if (!db || typeof db[key] !== 'object') throw new KnowledgeError('unavailable');
    }
    if (typeof db.$transaction !== 'function') throw new KnowledgeError('unavailable');
  }

  async read(scope: AiExecutionScope, documentId: string): Promise<KnowledgeRecord | null> {
    const where = columns(scope, documentId);
    const row = await this.db.aiKnowledgeDocument.findFirst({ where }).catch(() => unavailable());
    if (!row) return null;
    if (typeof row.state !== 'object' || row.state === null) throw new KnowledgeError('unavailable');
    const record = structuredClone(row.state) as unknown as KnowledgeRecord;
    if (!record.document || record.document.documentId !== documentId || !sameScope(record.document.scope, scope)
      || row.tenantId !== where.tenantId || row.workspaceId !== where.workspaceId || row.id !== documentId) throw new KnowledgeError('unavailable');
    return record;
  }

  async operation(scope: AiExecutionScope, documentId: string, operationId: string): Promise<KnowledgeOperation | null> {
    const value = workspace(scope);
    const row = await this.db.aiKnowledgeOperation.findFirst({ where: { tenantId: value.tenantId, workspaceId: value.workspaceId, documentId, operationId } }).catch(() => unavailable());
    if (!row) return null;
    if (row.operationId !== operationId || typeof row.fingerprint !== 'string') throw new KnowledgeError('unavailable');
    return { id: operationId, fingerprint: row.fingerprint, ...(typeof row.failure === 'string' ? { failure: row.failure as KnowledgeOperation['failure'] } : {}) };
  }

  async commit(input: {
    scope: AiExecutionScope; documentId: string; expectedRevision: number;
    operation: KnowledgeOperation; next: KnowledgeRecord; chunks?: AiKnowledgeChunkDraft[]; newVersion: boolean;
  }): Promise<'committed' | 'conflict'> {
    input = structuredClone(input);
    const value = workspace(input.scope);
    if (input.next.document.documentId !== input.documentId || !sameScope(input.next.document.scope, input.scope)) throw new KnowledgeError('conflict');
    if (input.chunks !== undefined) {
      validateChunks(input.next.document, input.chunks);
      if (input.next.document.parsing !== 'parsed') throw new KnowledgeError('invalid_input');
    }
    let writeAttempted = false, callbackCompleted = false;
    try {
      return await this.db.$transaction(async transaction => {
        const operation = await transaction.aiKnowledgeOperation.findFirst({ where: { tenantId: value.tenantId, workspaceId: value.workspaceId, documentId: input.documentId, operationId: input.operation.id } });
        if (operation) return operation.fingerprint === input.operation.fingerprint ? 'committed' : 'conflict';
        const existing = await transaction.aiKnowledgeDocument.findFirst({ where: columns(input.scope, input.documentId), include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
        const currentRevision = existing?.revision ?? 0;
        if (!Number.isSafeInteger(currentRevision) || currentRevision !== input.expectedRevision || input.next.revision !== currentRevision + 1) return 'conflict';
        if (input.newVersion && await transaction.aiKnowledgeVersion.findFirst({ where: { documentId: input.documentId, contentHash: input.next.document.documentVersion }, select: { id: true } })) throw new KnowledgeError('conflict');
        const now = this.clock();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new KnowledgeError('unavailable');
        const documentData = { tenantId: value.tenantId, workspaceId: value.workspaceId, title: input.next.document.title,
          status: input.next.document.publication, revision: input.next.revision, withdrawnAt: input.next.document.publication === 'withdrawn' ? now : null,
          state: json(input.next) };
        writeAttempted = true;
        if (!existing) await transaction.aiKnowledgeDocument.create({ data: { id: input.documentId, ...documentData } });
        else {
          const changed = await transaction.aiKnowledgeDocument.updateMany({ where: { ...columns(input.scope, input.documentId), revision: input.expectedRevision }, data: documentData });
          if (changed.count !== 1) throw new KnowledgeError('conflict');
        }
        const chunks = (input.chunks ?? []).map((chunk, index) => ({ id: randomUUID(), chunkIndex: index, text: chunk.text, tokenCount: chunk.text.length, state: json(chunk) }));
        if (input.newVersion) {
          const nextVersion = (existing?.versions[0]?.version ?? 0) + 1;
          await transaction.aiKnowledgeVersion.create({ data: { id: randomUUID(), documentId: input.documentId, version: nextVersion, status: input.next.document.publication, contentHash: input.next.document.documentVersion, chunks: { create: chunks } } });
        } else if (input.chunks !== undefined) {
          const version = existing?.versions[0];
          if (!version || version.documentId !== input.documentId || version.contentHash !== input.next.document.documentVersion
            || await transaction.aiKnowledgeChunk.findFirst({ where: { versionId: version.id }, select: { id: true } })) throw new KnowledgeError('conflict');
          for (const chunk of chunks) await transaction.aiKnowledgeChunk.create({ data: { ...chunk, versionId: version.id } });
        }
        await transaction.aiKnowledgeOperation.create({ data: { id: randomUUID(), documentId: input.documentId, tenantId: value.tenantId, workspaceId: value.workspaceId, operationId: input.operation.id, fingerprint: input.operation.fingerprint, ...(input.operation.failure ? { failure: input.operation.failure } : {}) } });
        callbackCompleted = true;
        return 'committed';
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof KnowledgeError) throw new KnowledgeError(error.code);
      if (!callbackCompleted && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) return 'conflict';
      // A completed callback is not proof that COMMIT's reply arrived.
      if (writeAttempted) throw new KnowledgeCommitUnknownError();
      throw new KnowledgeError('unavailable');
    }
  }
}
