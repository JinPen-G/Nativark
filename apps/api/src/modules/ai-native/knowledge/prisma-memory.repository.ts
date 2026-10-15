import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext, AiExecutionScope, AiKnowledgeOwnerDraft, AiMemoryDraft } from '@rental-os/shared';
import type { KnowledgeOperation, MemoryConfirmation, MemoryConfirmationPort, MemoryRepositoryPort } from './knowledge.ports';
import { KnowledgeCommitUnknownError, KnowledgeError, unavailable } from './knowledge-errors';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { actor, confirmationSchema, memoryConfirmationHash, memoryDraftSchema, parse, parsePersisted, sameScope, scopeSchema } from './knowledge-validation';

export type MemoryPrismaClient = Pick<PrismaClient, '$transaction' | 'aiStructuredMemory' | 'aiMemoryOperation' | 'aiHumanConfirmation'>;
const workspace = (scope: AiExecutionScope) => { const result = scopeSchema.safeParse(scope); if (!result.success || result.data.kind !== 'workspace') throw new KnowledgeError('unavailable'); return result.data; };
const json = (value: object): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class PrismaStructuredMemoryRepository implements MemoryRepositoryPort, MemoryConfirmationPort {
  constructor(private readonly db: MemoryPrismaClient, private readonly clock: () => Date = () => new Date()) {
    for (const key of ['aiStructuredMemory', 'aiMemoryOperation', 'aiHumanConfirmation'] as const) if (!db || typeof db[key] !== 'object') throw new KnowledgeError('unavailable');
    if (typeof db.$transaction !== 'function') throw new KnowledgeError('unavailable');
  }

  private async readMemory(scope: AiExecutionScope, owner: AiKnowledgeOwnerDraft, memoryId: string): Promise<AiMemoryDraft | null> {
    const value = workspace(scope), row = await this.db.aiStructuredMemory.findFirst({ where: { id: memoryId, tenantId: value.tenantId, workspaceId: value.workspaceId, ownerKind: owner.actorKind, ownerId: owner.actorId } }).catch(() => unavailable());
    if (!row) return null;
    return this.memory(row, value, owner, memoryId);
  }

  private memory(row: Prisma.AiStructuredMemoryGetPayload<{}>, scope: ReturnType<typeof workspace>, owner: AiKnowledgeOwnerDraft, memoryId: string): AiMemoryDraft {
    const memory = parsePersisted(memoryDraftSchema, row.state);
    const preference = memory.status === 'deleted' ? {} : memory.preference;
    if (memory.memoryId !== memoryId || !sameScope(memory.scope, scope) || requestFingerprint(memory.owner) !== requestFingerprint(owner)
      || row.id !== memoryId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
      || row.ownerKind !== owner.actorKind || row.ownerId !== owner.actorId || row.subjectType !== owner.actorKind || row.subjectId !== owner.actorId
      || row.revision !== memory.revision || row.scopeRevision !== memory.revision || row.aclRevision !== memory.aclRevision || row.status !== memory.status
      || !(row.expiresAt instanceof Date) || row.expiresAt.getTime() !== Date.parse(memory.expiresAt)
      || requestFingerprint(row.content) !== requestFingerprint(preference) || row.contentHash !== hash(preference)
      || row.confirmationRecordId !== (memory.status === 'confirmed' ? memory.confirmationRecordId : null)
      || (memory.status === 'deleted' ? !(row.deletedAt instanceof Date) || row.deletedAt.getTime() !== Date.parse(memory.deletedAt) : row.deletedAt !== null)) throw new KnowledgeError('unavailable');
    return memory;
  }

  private confirmation(row: Prisma.AiHumanConfirmationGetPayload<{}>, scope: ReturnType<typeof workspace>, recordId: string): MemoryConfirmation {
    const proof = parsePersisted(confirmationSchema, row.state);
    if (row.id !== recordId || proof.id !== recordId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || !sameScope(proof.scope, scope)
      || proof.owner.actorKind === 'automation' || row.subjectId !== proof.memoryId || row.proposalRevision !== proof.revision
      || row.status !== proof.status || row.confirmedBy !== proof.owner.actorId || row.proposalHash !== memoryConfirmationHash(proof)
      || !(row.expiresAt instanceof Date) || row.expiresAt.getTime() !== Date.parse(proof.expiresAt)) throw new KnowledgeError('unavailable');
    return proof;
  }

  private receipt(row: Prisma.AiMemoryOperationGetPayload<{}>, scope: ReturnType<typeof workspace>, memoryId: string, operationId: string): KnowledgeOperation {
    if (row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || row.memoryId !== memoryId || row.operationId !== operationId
      || typeof row.fingerprint !== 'string' || row.fingerprint.length < 1 || row.fingerprint.length > 128) throw new KnowledgeError('unavailable');
    return { id: operationId, fingerprint: row.fingerprint };
  }

  async operation(scope: AiExecutionScope, owner: AiKnowledgeOwnerDraft, memoryId: string, operationId: string): Promise<KnowledgeOperation | null> {
    const value = workspace(scope);
    return this.db.$transaction(async transaction => {
      const memory = await transaction.aiStructuredMemory.findFirst({ where: { id: memoryId, tenantId: value.tenantId, workspaceId: value.workspaceId, ownerKind: owner.actorKind, ownerId: owner.actorId } });
      if (!memory) return null;
      this.memory(memory, value, owner, memoryId);
      const row = await transaction.aiMemoryOperation.findFirst({ where: { tenantId: value.tenantId, workspaceId: value.workspaceId, memoryId, operationId } });
      return row ? this.receipt(row, value, memoryId, operationId) : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 }).catch(() => unavailable());
  }

  async commit(input: { scope: AiExecutionScope; owner: AiKnowledgeOwnerDraft; memoryId: string; expectedRevision: number; next: AiMemoryDraft; operation: KnowledgeOperation; confirmation?: MemoryConfirmation }): Promise<'committed' | 'conflict'> {
    input = structuredClone(input);
    input.next = parse(memoryDraftSchema, input.next);
    if (input.confirmation) input.confirmation = parse(confirmationSchema, input.confirmation);
    const value = workspace(input.scope), now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || input.next.memoryId !== input.memoryId || !sameScope(input.next.scope, input.scope) || input.next.owner.actorKind !== input.owner.actorKind || input.next.owner.actorId !== input.owner.actorId) throw new KnowledgeError('conflict');
    let writeAttempted = false, callbackCompleted = false;
    try {
      return await this.db.$transaction(async transaction => {
        const existing = await transaction.aiStructuredMemory.findFirst({ where: { id: input.memoryId, tenantId: value.tenantId, workspaceId: value.workspaceId, ownerKind: input.owner.actorKind, ownerId: input.owner.actorId } });
        if (existing) this.memory(existing, value, input.owner, input.memoryId);
        const existingOperation = await transaction.aiMemoryOperation.findFirst({ where: { tenantId: value.tenantId, workspaceId: value.workspaceId, memoryId: input.memoryId, operationId: input.operation.id } });
        if (existingOperation) {
          if (!existing) throw new KnowledgeError('conflict');
          return this.receipt(existingOperation, value, input.memoryId, input.operation.id).fingerprint === input.operation.fingerprint ? 'committed' : 'conflict';
        }
        const currentRevision = existing?.revision ?? 0;
        if (!Number.isSafeInteger(currentRevision) || currentRevision !== input.expectedRevision || input.next.revision !== currentRevision + 1) return 'conflict';
        if (input.next.status === 'confirmed') {
          const proof = input.confirmation;
          if (!proof || proof.id !== input.next.confirmationRecordId || proof.status !== 'confirmed'
            || proof.memoryId !== input.memoryId || proof.revision !== currentRevision || proof.aclRevision !== input.next.aclRevision
            || !sameScope(proof.scope, input.scope) || requestFingerprint(proof.owner) !== requestFingerprint(input.owner)
            || requestFingerprint(proof.preference) !== requestFingerprint(input.next.preference) || proof.memoryExpiresAt !== input.next.expiresAt
            || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= this.clock().getTime()) throw new KnowledgeError('conflict');
          const confirmation = await transaction.aiHumanConfirmation.findFirst({ where: { id: proof.id, tenantId: value.tenantId, workspaceId: value.workspaceId } });
          if (!confirmation || requestFingerprint(this.confirmation(confirmation, value, proof.id)) !== requestFingerprint(proof)) throw new KnowledgeError('conflict');
        }
        const preference = input.next.status === 'deleted' ? {} : input.next.preference;
        const data = { tenantId: value.tenantId, workspaceId: value.workspaceId, subjectType: input.owner.actorKind, subjectId: input.owner.actorId,
          scopeRevision: input.next.revision, revision: input.next.revision, ownerKind: input.owner.actorKind, ownerId: input.owner.actorId,
          aclRevision: input.next.aclRevision, content: json(preference), contentHash: hash(preference), status: input.next.status,
          ...(input.next.status === 'confirmed' ? { confirmationRecordId: input.next.confirmationRecordId } : { confirmationRecordId: null }),
          ...(input.next.status === 'deleted' ? { deletedAt: new Date(input.next.deletedAt) } : { deletedAt: null }), expiresAt: new Date(input.next.expiresAt), state: json(input.next) };
        writeAttempted = true;
        if (!existing) await transaction.aiStructuredMemory.create({ data: { id: input.memoryId, ...data } });
        else {
          const changed = await transaction.aiStructuredMemory.updateMany({ where: { id: input.memoryId, tenantId: value.tenantId,
            workspaceId: value.workspaceId, ownerKind: input.owner.actorKind, ownerId: input.owner.actorId, revision: input.expectedRevision }, data });
          if (changed.count !== 1) throw new KnowledgeError('conflict');
        }
        if (input.next.status === 'deleted') {
          // Confirmation JSON contains the same preference as the memory head,
          // including older revisions. Keep receipt IDs/hashes, but atomically
          // remove this owner's duplicate plaintext and revoke its reuse. The
          // JSON predicates exclude generic approvals and colliding subjects.
          await transaction.aiHumanConfirmation.updateMany({ where: {
            tenantId: value.tenantId, workspaceId: value.workspaceId, subjectId: input.memoryId,
            confirmedBy: input.owner.actorId,
            AND: [{ state: { path: '$.memoryId', equals: input.memoryId } },
              { state: { path: '$.owner.actorKind', equals: input.owner.actorKind } },
              { state: { path: '$.owner.actorId', equals: input.owner.actorId } }],
          }, data: { status: 'revoked', state: Prisma.DbNull } });
        }
        await transaction.aiMemoryOperation.create({ data: { id: randomUUID(), memoryId: input.memoryId, tenantId: value.tenantId, workspaceId: value.workspaceId, operationId: input.operation.id, fingerprint: input.operation.fingerprint } });
        callbackCompleted = true;
        return 'committed';
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof KnowledgeError) throw new KnowledgeError(error.code);
      if (!callbackCompleted && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) return 'conflict';
      if (writeAttempted) throw new KnowledgeCommitUnknownError();
      throw new KnowledgeError('unavailable');
    }
  }

  async readConfirmation(context: AiExecutionContext, confirmationRecordId: string): Promise<MemoryConfirmation | null> {
    const value = workspace(context.scope), row = await this.db.aiHumanConfirmation.findFirst({ where: { id: confirmationRecordId, tenantId: value.tenantId, workspaceId: value.workspaceId } }).catch(() => unavailable());
    if (!row) return null;
    const proof = this.confirmation(row, value, confirmationRecordId);
    if (proof.audience !== context.audience || requestFingerprint(proof.owner) !== requestFingerprint(actor(context))) throw new KnowledgeError('unavailable');
    return proof;
  }

  read(context: AiExecutionContext, confirmationRecordId: string): Promise<MemoryConfirmation | null>;
  read(scope: AiExecutionScope, owner: AiKnowledgeOwnerDraft, memoryId: string): Promise<AiMemoryDraft | null>;
  read(first: AiExecutionContext | AiExecutionScope, second: AiKnowledgeOwnerDraft | string, third?: string): Promise<AiMemoryDraft | MemoryConfirmation | null> {
    if (typeof second === 'string') return this.readConfirmation(first as AiExecutionContext, second);
    return this.readMemory(first as AiExecutionScope, second, third!);
  }
}
