import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiExecutionContext, type AiMemoryDraft } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { PrismaStructuredMemoryRepository, type MemoryPrismaClient } from './prisma-memory.repository';
import { StructuredMemoryService } from './structured-memory.service';
import type { KnowledgeClock, MemoryAuthorizationPort, MemoryConfirmation } from './knowledge.ports';
import { KnowledgeCommitUnknownError, KnowledgeError, requiredPort, unavailable } from './knowledge-errors';
import { actor, fingerprint, id, memoryConfirmationHash, parse, sameScope } from './knowledge-validation';

const inputSchema = z.object({ memoryId: id, expectedRevision: z.number().int().min(1).max(4294967293),
  operationId: id.max(110), expiresAt: z.string().datetime({ offset: true }) }).strict();
const identityKey = (context: AiExecutionContext) => fingerprint([context.actor, context.audience, context.scope, 'access' in context ? context.access : null]);

/** Explicit human action, not an AI tool or HTTP endpoint. Reuses the existing
 * identity resolver, consent table, confirmation hash and memory consumer.
 * Authorization is mandatory: current membership alone grants no memory action.
 */
export class PersistentMemoryConsentService {
  private readonly identities: AiTaskCurrentIdentityAuthority;
  private readonly repository: PrismaStructuredMemoryRepository;
  private readonly memory: StructuredMemoryService;

  constructor(private readonly ports: {
    db: MemoryPrismaClient; auth: Pick<AuthService, 'resolveAccessContext'>;
    credentials: AiTaskCredentialSource; authorization: MemoryAuthorizationPort; clock: KnowledgeClock;
  }) {
    requiredPort(ports?.authorization, ['authorize']); requiredPort(ports?.clock, ['now']);
    requiredPort(ports?.db?.aiHumanConfirmation, ['findFirst', 'create']);
    this.identities = new AiTaskCurrentIdentityAuthority(ports.auth, ports.credentials, () => new Date(ports.clock.now()));
    this.repository = new PrismaStructuredMemoryRepository(ports.db, () => new Date(ports.clock.now()));
    this.memory = new StructuredMemoryService({ repository: this.repository, confirmations: this.repository,
      authorization: { authorize: (context, request) => this.authorizeRequest(context, request) }, clock: ports.clock });
  }

  private async current(): Promise<AiExecutionContext> {
    try { return await this.identities.resolve(); } catch { return unavailable(); }
  }

  private async authorizeRequest(context: AiExecutionContext, original: Parameters<MemoryAuthorizationPort['authorize']>[1]) {
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace') unavailable();
    const stable = structuredClone(context), key = identityKey(stable);
    if (identityKey(await this.current()) !== key || !sameScope(original.scope, stable.scope)
      || fingerprint(original.owner) !== fingerprint(actor(stable))) unavailable();
    const request = structuredClone(original);
    const requestHash = fingerprint(request);
    const answer = await this.ports.authorization.authorize(stable, request);
    if (identityKey(stable) !== key || fingerprint(request) !== requestHash || identityKey(await this.current()) !== key) unavailable();
    if (!answer || !sameScope(answer.scope, context.scope) || fingerprint(answer.actor) !== fingerprint(actor(context))
      || answer.audience !== context.audience || typeof answer.accessKey !== 'string' || !answer.accessKey || answer.accessKey.length > 256) unavailable();
    return structuredClone(answer);
  }

  private async authorize(context: AiExecutionContext, memory?: AiMemoryDraft): Promise<void> {
    await this.authorizeRequest(context, { action: 'confirm', scope: context.scope, owner: actor(context), ...(memory ? { memory } : {}) });
  }

  async read(memoryId: string): Promise<AiMemoryDraft> {
    return this.memory.read(await this.current(), parse(id, memoryId));
  }

  async propose(value: unknown): Promise<AiMemoryDraft> {
    return this.memory.propose(await this.current(), value);
  }

  /** Editing invalidates the old consent; deletion uses the existing tombstone.
   * The human facade has no arbitrary confirmationId consumption shortcut.
   */
  async change(operationId: string, value: unknown): Promise<AiMemoryDraft> {
    if (!value || typeof value !== 'object' || !('operation' in value)
      || !['modify', 'delete'].includes(String(value.operation))) throw new KnowledgeError('invalid_input');
    return this.memory.change(await this.current(), operationId, value);
  }

  /** Withdraw one's consent using the existing delete action gate. The record
   * becomes revoked; this is not a claim that the preference has been deleted.
   */
  async revoke(value: unknown): Promise<MemoryConfirmation> {
    const input = parse(z.object({ memoryId: id, expectedRevision: z.number().int().min(2).max(4294967294) }).strict(), value);
    const context = await this.current();
    if (context.scope.kind !== 'workspace') return unavailable();
    const scope = context.scope, owner = actor(context);
    await this.authorizeRequest(context, { action: 'delete', scope, owner });
    let attempted = false, callbackCompleted = false;
    try {
      return await this.ports.db.$transaction(async tx => {
        const repository = new PrismaStructuredMemoryRepository({ $transaction: this.ports.db.$transaction.bind(this.ports.db),
          aiStructuredMemory: tx.aiStructuredMemory, aiMemoryOperation: tx.aiMemoryOperation, aiHumanConfirmation: tx.aiHumanConfirmation },
        () => new Date(this.ports.clock.now()));
        const memory = await repository.read(scope, owner, input.memoryId);
        if (!memory || memory.status !== 'confirmed') return unavailable();
        if (memory.revision !== input.expectedRevision) throw new KnowledgeError('conflict');
        await this.authorizeRequest(context, { action: 'delete', scope, owner, memory });
        const proof = await repository.read(context, memory.confirmationRecordId);
        if (!proof || proof.memoryId !== memory.memoryId || proof.revision !== memory.revision - 1
          || proof.aclRevision !== memory.aclRevision || fingerprint(proof.preference) !== fingerprint(memory.preference)
          || proof.memoryExpiresAt !== memory.expiresAt) return unavailable();
        if (proof.status === 'revoked') {
          await this.authorizeRequest(context, { action: 'delete', scope, owner, memory });
          callbackCompleted = true;
          return proof;
        }
        attempted = true;
        const lock = await tx.aiStructuredMemory.updateMany({ where: { id: input.memoryId, tenantId: scope.tenantId,
          workspaceId: scope.workspaceId, ownerKind: owner.actorKind, ownerId: owner.actorId,
          revision: input.expectedRevision, status: 'confirmed', confirmationRecordId: proof.id }, data: { revision: input.expectedRevision } });
        if (lock.count !== 1) throw new KnowledgeError('conflict');
        const revoked: MemoryConfirmation = { ...proof, status: 'revoked' };
        const changed = await tx.aiHumanConfirmation.updateMany({ where: { id: proof.id, tenantId: scope.tenantId,
          workspaceId: scope.workspaceId, subjectId: memory.memoryId, proposalRevision: proof.revision,
          proposalHash: memoryConfirmationHash(proof), confirmedBy: owner.actorId, status: 'confirmed' },
        data: { status: 'revoked', state: JSON.parse(JSON.stringify(revoked)) as Prisma.InputJsonValue } });
        if (changed.count !== 1) throw new KnowledgeError('conflict');
        await this.authorizeRequest(context, { action: 'delete', scope, owner, memory });
        callbackCompleted = true;
        return revoked;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof KnowledgeError) throw error;
      if (!callbackCompleted && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new KnowledgeError('conflict');
      if (attempted) throw new KnowledgeCommitUnknownError();
      return unavailable();
    }
  }

  async confirm(value: unknown): Promise<AiMemoryDraft> {
    const input = parse(inputSchema, value), context = await this.current();
    await this.authorize(context);
    if (context.scope.kind !== 'workspace') return unavailable();
    const scope = context.scope, owner = actor(context);
    const now = this.ports.clock.now(), expiry = Date.parse(input.expiresAt);
    if (!Number.isFinite(now) || expiry <= now || expiry > now + 90 * 86400000) throw new KnowledgeError('invalid_input');
    let attempted = false, callbackCompleted = false;
    let proof: MemoryConfirmation;
    try {
      proof = await this.ports.db.$transaction(async tx => {
        const repository = new PrismaStructuredMemoryRepository({ $transaction: this.ports.db.$transaction.bind(this.ports.db),
          aiStructuredMemory: tx.aiStructuredMemory, aiMemoryOperation: tx.aiMemoryOperation, aiHumanConfirmation: tx.aiHumanConfirmation },
        () => new Date(this.ports.clock.now()));
        const memory = await repository.read(scope, owner, input.memoryId);
        if (!memory || memory.status === 'deleted' || Date.parse(memory.expiresAt) <= this.ports.clock.now()) return unavailable();
        await this.authorize(context, memory);
        const existing = await tx.aiHumanConfirmation.findFirst({ where: { tenantId: scope.tenantId, idempotencyKey: input.operationId } });
        if (existing) {
          // Read through the existing strict column/JSON binding checks.
          const old = await repository.read(context, existing.id);
          if (!old || old.status !== 'confirmed') return unavailable();
          if (old.memoryId !== input.memoryId || old.revision !== input.expectedRevision || old.expiresAt !== input.expiresAt
            || old.aclRevision !== memory.aclRevision || fingerprint(old.preference) !== fingerprint(memory.preference)
            || old.memoryExpiresAt !== memory.expiresAt) throw new KnowledgeError('conflict');
          if (memory.status === 'proposed' ? memory.revision !== old.revision
            : memory.revision !== old.revision + 1 || memory.confirmationRecordId !== old.id) return unavailable();
          await this.authorize(context, memory);
          callbackCompleted = true;
          return old;
        }
        if (memory.status !== 'proposed' || memory.revision !== input.expectedRevision || expiry > Date.parse(memory.expiresAt)) throw new KnowledgeError('conflict');
        // Conditional update locks this exact owner/scope/revision while creating
        // consent. It does not confirm or modify the preference itself.
        attempted = true;
        const locked = await tx.aiStructuredMemory.updateMany({ where: { id: input.memoryId, tenantId: scope.tenantId,
          workspaceId: scope.workspaceId, ownerKind: owner.actorKind, ownerId: owner.actorId,
          revision: input.expectedRevision, status: 'proposed', aclRevision: memory.aclRevision }, data: { revision: input.expectedRevision } });
        if (locked.count !== 1) throw new KnowledgeError('conflict');
        const after = await repository.read(scope, owner, input.memoryId);
        if (!after || fingerprint(after) !== fingerprint(memory)) throw new KnowledgeError('conflict');
        await this.authorize(context, after);
        if (expiry <= this.ports.clock.now()) return unavailable();
        const next: MemoryConfirmation = { id: randomUUID(), memoryId: input.memoryId, revision: memory.revision,
          aclRevision: memory.aclRevision, owner, scope, audience: context.audience, preference: memory.preference,
          memoryExpiresAt: memory.expiresAt, status: 'confirmed', issuedAt: new Date(now).toISOString(), expiresAt: input.expiresAt };
        await tx.aiHumanConfirmation.create({ data: { id: next.id, tenantId: scope.tenantId, workspaceId: scope.workspaceId,
          subjectId: next.memoryId, idempotencyKey: input.operationId, proposalHash: memoryConfirmationHash(next),
          proposalRevision: next.revision, status: next.status, confirmedBy: owner.actorId, expiresAt: new Date(next.expiresAt),
          state: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue } });
        await this.authorize(context, after);
        callbackCompleted = true;
        return next;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof KnowledgeError) throw error;
      if (!callbackCompleted && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new KnowledgeError('conflict');
      if (attempted) throw new KnowledgeCommitUnknownError();
      return unavailable();
    }
    // Separate durable boundaries: if interrupted here, retry the SAME operation
    // to read its proof; never create another approval or claim atomic completion.
    await this.authorize(context);
    return this.memory.change(context, `${input.operationId}_memory`, { draftVersion: AI_KNOWLEDGE_DRAFT_VERSION,
      memoryId: input.memoryId, expectedRevision: input.expectedRevision, operation: 'confirm', confirmationRecordId: proof.id });
  }
}
