import { createHash, randomUUID } from 'node:crypto';
import type { AiExecutionContext, AiExecutionScope, AiKnowledgeOwnerDraft, AiMemoryDraft } from '@rental-os/shared';
import type { KnowledgeOperation, MemoryConfirmation, MemoryConfirmationPort, MemoryRepositoryPort } from './knowledge.ports';
import { KnowledgeError } from './knowledge-errors';
import { sameScope, scopeSchema } from './knowledge-validation';

type Delegate = { findFirst(args: unknown): Promise<unknown>; create(args: unknown): Promise<unknown>; update(args: unknown): Promise<unknown> };
type MemoryTransaction = { aiStructuredMemory: Delegate; aiMemoryOperation: Delegate; aiHumanConfirmation: Delegate };
export interface MemoryPrismaClient extends MemoryTransaction { $transaction<T>(callback: (transaction: MemoryTransaction) => Promise<T>): Promise<T>; }
const workspace = (scope: AiExecutionScope) => { const result = scopeSchema.safeParse(scope); if (!result.success || result.data.kind !== 'workspace') throw new KnowledgeError('unavailable'); return result.data; };
const json = (value: unknown) => structuredClone(value);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Persistent memory CAS and confirmation reader. It never creates a human confirmation. */
export class PrismaStructuredMemoryRepository implements MemoryRepositoryPort, MemoryConfirmationPort {
  constructor(private readonly db: MemoryPrismaClient, private readonly clock: () => Date = () => new Date()) {
    for (const key of ['aiStructuredMemory', 'aiMemoryOperation', 'aiHumanConfirmation']) if (!db || typeof (db as unknown as Record<string, unknown>)[key] !== 'object') throw new KnowledgeError('unavailable');
    if (typeof db.$transaction !== 'function') throw new KnowledgeError('unavailable');
  }

  private async readMemory(scope: AiExecutionScope, owner: AiKnowledgeOwnerDraft, memoryId: string): Promise<AiMemoryDraft | null> {
    const value = workspace(scope), row = await this.db.aiStructuredMemory.findFirst({ where: { id: memoryId, tenantId: value.tenantId, workspaceId: value.workspaceId, ownerKind: owner.actorKind, ownerId: owner.actorId } });
    if (!row) return null;
    const state = (row as { state?: unknown }).state;
    if (!state || typeof state !== 'object') throw new KnowledgeError('unavailable');
    const memory = json(state) as AiMemoryDraft;
    if (memory.memoryId !== memoryId || !sameScope(memory.scope, scope) || memory.owner.actorKind !== owner.actorKind || memory.owner.actorId !== owner.actorId) throw new KnowledgeError('unavailable');
    return memory;
  }

  async operation(scope: AiExecutionScope, owner: AiKnowledgeOwnerDraft, memoryId: string, operationId: string): Promise<KnowledgeOperation | null> {
    const value = workspace(scope), row = await this.db.aiMemoryOperation.findFirst({ where: { tenantId: value.tenantId, workspaceId: value.workspaceId, memoryId, operationId } });
    if (!row) return null;
    const item = row as { fingerprint?: unknown };
    if (typeof item.fingerprint !== 'string') throw new KnowledgeError('unavailable');
    return { id: operationId, fingerprint: item.fingerprint };
  }

  async commit(input: { scope: AiExecutionScope; owner: AiKnowledgeOwnerDraft; memoryId: string; expectedRevision: number; next: AiMemoryDraft; operation: KnowledgeOperation; confirmation?: MemoryConfirmation }): Promise<'committed' | 'conflict'> {
    const value = workspace(input.scope), now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || input.next.memoryId !== input.memoryId || !sameScope(input.next.scope, input.scope) || input.next.owner.actorKind !== input.owner.actorKind || input.next.owner.actorId !== input.owner.actorId) throw new KnowledgeError('conflict');
    try {
      return await this.db.$transaction(async transaction => {
        const existingOperation = await transaction.aiMemoryOperation.findFirst({ where: { tenantId: value.tenantId, workspaceId: value.workspaceId, memoryId: input.memoryId, operationId: input.operation.id } });
        if (existingOperation) return (existingOperation as { fingerprint?: unknown }).fingerprint === input.operation.fingerprint ? 'committed' : 'conflict';
        const existing = await transaction.aiStructuredMemory.findFirst({ where: { id: input.memoryId, tenantId: value.tenantId, workspaceId: value.workspaceId, ownerKind: input.owner.actorKind, ownerId: input.owner.actorId } });
        const currentRevision = existing ? Number((existing as { revision?: unknown }).revision) : 0;
        if (!Number.isSafeInteger(currentRevision) || currentRevision !== input.expectedRevision || input.next.revision !== currentRevision + 1) return 'conflict';
        const preference = input.next.status === 'deleted' ? {} : input.next.preference;
        const data = { tenantId: value.tenantId, workspaceId: value.workspaceId, subjectType: input.owner.actorKind, subjectId: input.owner.actorId,
          scopeRevision: input.next.revision, revision: input.next.revision, ownerKind: input.owner.actorKind, ownerId: input.owner.actorId,
          aclRevision: input.next.aclRevision, content: json(preference), contentHash: hash(preference), status: input.next.status,
          ...(input.next.status === 'confirmed' ? { confirmationRecordId: input.next.confirmationRecordId } : { confirmationRecordId: null }),
          ...(input.next.status === 'deleted' ? { deletedAt: new Date(input.next.deletedAt) } : { deletedAt: null }), expiresAt: new Date(input.next.expiresAt), state: json(input.next) };
        if (!existing) await transaction.aiStructuredMemory.create({ data: { id: input.memoryId, ...data } });
        else await transaction.aiStructuredMemory.update({ where: { id: input.memoryId }, data });
        await transaction.aiMemoryOperation.create({ data: { id: randomUUID(), memoryId: input.memoryId, tenantId: value.tenantId, workspaceId: value.workspaceId, operationId: input.operation.id, fingerprint: input.operation.fingerprint } });
        return 'committed';
      });
    } catch (error) { if (error instanceof KnowledgeError) throw error; return 'conflict'; }
  }

  async readConfirmation(context: AiExecutionContext, confirmationRecordId: string): Promise<MemoryConfirmation | null> {
    const value = workspace(context.scope), row = await this.db.aiHumanConfirmation.findFirst({ where: { id: confirmationRecordId, tenantId: value.tenantId, workspaceId: value.workspaceId } });
    if (!row) return null;
    const state = (row as { state?: unknown }).state;
    if (!state || typeof state !== 'object') throw new KnowledgeError('unavailable');
    return json(state) as MemoryConfirmation;
  }

  read(context: AiExecutionContext, confirmationRecordId: string): Promise<MemoryConfirmation | null>;
  read(scope: AiExecutionScope, owner: AiKnowledgeOwnerDraft, memoryId: string): Promise<AiMemoryDraft | null>;
  read(first: AiExecutionContext | AiExecutionScope, second: AiKnowledgeOwnerDraft | string, third?: string): Promise<AiMemoryDraft | MemoryConfirmation | null> {
    if (typeof second === 'string') return this.readConfirmation(first as AiExecutionContext, second);
    return this.readMemory(first as AiExecutionScope, second, third!);
  }
}
