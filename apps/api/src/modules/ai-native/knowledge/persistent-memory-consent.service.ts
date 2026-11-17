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
import { actor, fingerprint, id, memoryConfirmationHash, operationFingerprint, parse, preferenceSchema, sameScope } from './knowledge-validation';
import { preferenceAmbiguities } from './preference-ambiguities';
import { inspectRetentionSource, lockRetentionSourceScope } from '../privacy/retention-model-sources';
import { eraseRetainedSourceTaskBodies } from '../privacy/retention-task-bodies';
import { AiTaskRepositoryError } from '../ai-task.repository';

const inputSchema = z.object({ memoryId: id, expectedRevision: z.number().int().min(1).max(4294967293),
  operationId: id.max(110), expiresAt: z.string().datetime({ offset: true }) }).strict();
const identityKey = (context: AiExecutionContext) => fingerprint([context.actor, context.audience, context.scope, 'access' in context ? context.access : null]);
const preferenceSelectionInput = z.object({ kinds: z.array(z.enum(['locale', 'fulfillment_location', 'display_density'])).min(1).max(3),
  limit: z.number().int().min(1).max(10) }).strict();
const selectedPreference = z.object({ memoryId: id, revision: z.number().int().min(2).max(4294967294),
  aclRevision: z.number().int().min(1).max(4294967294), expiresAt: z.string().datetime({ offset: true }),
  preference: preferenceSchema, confirmationRecordId: id }).strict();
const preferenceSelectionSnapshot = preferenceSelectionInput.extend({
  scope: z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict(),
  owner: z.object({ actorKind: z.literal('user'), actorId: id }).strict(),
  audience: z.enum(['operator', 'staff', 'client']), items: z.array(selectedPreference).max(10),
  truncated: z.boolean(), semantics: z.literal('explicit_preference_selection_not_authority'),
  requestedKinds: preferenceSelectionInput.shape.kinds,
  ambiguities: z.array(z.object({ kind: z.enum(['locale', 'fulfillment_location', 'display_density']),
    memoryIds: z.array(id).min(2).max(10), nextStep: z.literal('human_selection') }).strict()).max(3),
  ambiguityCoverage: z.literal('returned_items_only'), businessCompatibility: z.literal('unavailable')
}).strict();

/** Explicit human action using original consent/CAS receipts and current
 * authority. Delete/modify share scheduled source holds under the scope lock.
 * Consent revocation stops reuse immediately and retains held body evidence.
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

  private transactionRepository(tx: Prisma.TransactionClient) {
    // Repository callback transactions must stay on the already locked source
    // transaction. Opening another Prisma transaction would lose that boundary.
    const bound = new Proxy(this.ports.db, { get(_target, key) {
      if (key === '$transaction') return (work: unknown) => {
        if (typeof work !== 'function') return unavailable();
        return work(tx);
      };
      return Reflect.get(tx, key);
    } });
    return new PrismaStructuredMemoryRepository(bound, () => new Date(this.ports.clock.now()));
  }

  private async sourceChangeReady(tx: Prisma.TransactionClient, memoryId: string,
    locked: Awaited<ReturnType<typeof lockRetentionSourceScope>>) {
    const { scopeId, owner } = locked;
    const state = await inspectRetentionSource(tx, scopeId, 'memory', memoryId, owner);
    if (state !== 'clear') throw Object.assign(new KnowledgeError(state === 'held' ? 'not_ready' : 'unavailable'), {
      reason: state === 'held' ? 'referenced_by_unresolved_task' : 'source_task_binding_unavailable',
    });
  }

  private async commitSourceChange(context: AiExecutionContext,
    input: Parameters<PrismaStructuredMemoryRepository['commit']>[0]) {
    const action = input.next.status === 'deleted' ? 'delete' as const : 'modify' as const;
    const request = { action, scope: input.scope, owner: input.owner };
    await this.authorizeRequest(context, request);
    let attempted = false, completed = false;
    try {
      return await this.ports.db.$transaction(async tx => {
        const locked = await lockRetentionSourceScope(tx, context.scope);
        const repository = this.transactionRepository(tx);
        // Same-key recovery precedes new hold/copy checks. It observes the old
        // committed CAS; new tasks cannot turn that receipt into a new mutation.
        const receipt = await repository.operation(input.scope, input.owner, input.memoryId, input.operation.id);
        if (receipt) {
          if (receipt.fingerprint !== input.operation.fingerprint) throw new KnowledgeError('conflict');
          await this.authorizeRequest(context, request);
          completed = true;
          return 'committed' as const;
        }
        await this.sourceChangeReady(tx, input.memoryId, locked);
        const before = await repository.read(input.scope, input.owner, input.memoryId);
        if (!before || before.status === 'deleted' || before.revision !== input.expectedRevision) throw new KnowledgeError('conflict');
        const grant = await this.authorizeRequest(context, { ...request, memory: before });
        if (fingerprint(await this.authorizeRequest(context, { ...request, memory: before })) !== fingerprint(grant)) return unavailable();
        attempted = true;
        await eraseRetainedSourceTaskBodies(tx, { ...locked, kind: 'memory', resourceId: input.memoryId,
          now: new Date(this.ports.clock.now()), check: async () => {
            if (fingerprint(await this.authorizeRequest(context, { ...request, memory: before })) !== fingerprint(grant)) return unavailable();
          } });
        const result = await repository.commit(input);
        if (result !== 'committed') throw new KnowledgeError('conflict');
        await this.authorizeRequest(context, { ...request, memory: before });
        completed = true;
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (completed) throw new KnowledgeCommitUnknownError();
      if (error instanceof KnowledgeError) throw error;
      if (error instanceof AiTaskRepositoryError) throw new KnowledgeError('unavailable');
      if (attempted) throw new KnowledgeCommitUnknownError();
      return unavailable();
    }
  }

  async read(memoryId: string): Promise<AiMemoryDraft> {
    return this.memory.read(await this.current(), parse(id, memoryId));
  }

  /** Bounded owner-only discovery, not preference reuse or an atomic snapshot.
   * Probe rows receive the same resource checks as displayed rows. */
  async list(value: unknown) {
    const input = parse(z.object({ limit: z.number().int().min(1).max(30), after: id.optional() }).strict(), value);
    const context = await this.current(), owner = actor(context);
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner });
    if (context.scope.kind !== 'workspace') return unavailable();
    requiredPort(this.ports.db.aiStructuredMemory, ['findMany']);
    const rows = await this.ports.db.aiStructuredMemory.findMany({ where: {
      tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
      ownerKind: owner.actorKind, ownerId: owner.actorId, ...(input.after ? { id: { gt: input.after } } : {}),
    }, orderBy: { id: 'asc' }, take: input.limit + 1,
    select: { id: true, tenantId: true, workspaceId: true, ownerKind: true, ownerId: true },
    }).catch(() => unavailable());
    if (rows.length > input.limit + 1 || new Set(rows.map(row => row.id)).size !== rows.length) return unavailable();
    for (const row of rows) {
      parse(id, row.id);
      if (row.tenantId !== context.scope.tenantId || row.workspaceId !== context.scope.workspaceId
        || row.ownerKind !== owner.actorKind || row.ownerId !== owner.actorId) return unavailable();
    }
    // Let the database collation define keyset order; never sort an already
    // limited page with a different JavaScript collation.
    const observed = [];
    for (const row of rows) observed.push(await this.state(row.id));
    // A later row's await must not leave earlier metadata authorized by an old
    // policy or conceal consent revocation during page assembly.
    for (const state of observed) {
      if (fingerprint(await this.state(state.memoryId)) !== fingerprint(state)) throw new KnowledgeError('conflict');
    }
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner });
    const items = observed.slice(0, input.limit);
    return { items, nextAfter: rows.length > input.limit ? items[items.length - 1].memoryId : null,
      semantics: 'owner_metadata_not_preference_reuse' as const };
  }

  /** Management metadata remains readable with the formal read action even
   * when revoked consent correctly prevents preference reuse. No preference
   * body is returned by this status endpoint.
   */
  async state(memoryId: string) {
    parse(id, memoryId);
    const context = await this.current(), owner = actor(context);
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner });
    const before = await this.repository.read(context.scope, owner, memoryId);
    if (!before) return unavailable();
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner, memory: before });
    const proof = before.status === 'confirmed' ? await this.repository.read(context, before.confirmationRecordId) : null;
    const bound = proof && before.status === 'confirmed' && proof.memoryId === memoryId
      && proof.revision === before.revision - 1 && proof.aclRevision === before.aclRevision
      && fingerprint(proof.preference) === fingerprint(before.preference) && proof.memoryExpiresAt === before.expiresAt;
    const now = this.ports.clock.now();
    if (!Number.isFinite(now)) return unavailable();
    const consent = before.status !== 'confirmed' ? 'not_confirmed' as const : !bound ? 'invalidated' as const
      : proof.status === 'revoked' ? 'revoked' as const
        : Date.parse(proof.expiresAt) > Date.parse(before.expiresAt) ? 'invalidated' as const
          : Date.parse(proof.expiresAt) <= now || Date.parse(proof.issuedAt) > now ? 'expired' as const : 'confirmed' as const;
    const after = await this.repository.read(context.scope, owner, memoryId);
    const latestProof = before.status === 'confirmed' ? await this.repository.read(context, before.confirmationRecordId) : null;
    if (fingerprint(before) !== fingerprint(after) || fingerprint(proof) !== fingerprint(latestProof)) throw new KnowledgeError('conflict');
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner, memory: before });
    return { memoryId, revision: before.revision, aclRevision: before.aclRevision,
      storageStatus: before.status, consentStatus: consent, expiresAt: before.expiresAt,
      usable: before.status === 'confirmed' && consent === 'confirmed' && Date.parse(before.expiresAt) > now,
      semantics: 'preference_not_authority' as const };
  }

  async confirmationDetail(memoryId: string) {
    parse(id, memoryId);
    const context = await this.current(), owner = actor(context);
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner });
    const memory = await this.repository.read(context.scope, owner, memoryId);
    if (!memory || memory.status !== 'confirmed') return unavailable();
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner, memory });
    const proof = await this.repository.read(context, memory.confirmationRecordId);
    if (!proof || proof.memoryId !== memoryId || proof.revision !== memory.revision - 1
      || fingerprint(proof.preference) !== fingerprint(memory.preference) || proof.aclRevision !== memory.aclRevision
      || proof.memoryExpiresAt !== memory.expiresAt) return unavailable();
    const after = await this.repository.read(context.scope, owner, memoryId);
    if (!after || fingerprint(after) !== fingerprint(memory)) throw new KnowledgeError('conflict');
    // Revoking consent does not increment the memory revision. Re-read the
    // durable proof itself, then recheck the current human/resource permission
    // after both storage waits before exposing the historical consent value.
    const latestProof = await this.repository.read(context, memory.confirmationRecordId);
    if (!latestProof || fingerprint(latestProof) !== fingerprint(proof)) throw new KnowledgeError('conflict');
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner, memory: after });
    return { memoryId, confirmationRecordId: proof.id, preference: structuredClone(proof.preference),
      revision: proof.revision, aclRevision: proof.aclRevision, scope: structuredClone(proof.scope),
      audience: proof.audience, confirmedAt: proof.issuedAt, expiresAt: proof.expiresAt,
      status: proof.status, semantics: 'persistent_confirmation_record_not_current_preference_reconstruction' as const };
  }

  async changeStatus(operationId: string, value: unknown) {
    parse(id, operationId);
    const base = { draftVersion: z.literal(AI_KNOWLEDGE_DRAFT_VERSION), memoryId: id,
      expectedRevision: z.number().int().min(1).max(4294967293) };
    const input = parse(z.discriminatedUnion('operation', [
      z.object({ ...base, operation: z.literal('modify'), preference: preferenceSchema }).strict(),
      z.object({ ...base, operation: z.literal('delete') }).strict(),
    ]), value);
    const context = await this.current(), owner = actor(context);
    await this.authorizeRequest(context, { action: input.operation, scope: context.scope, owner });
    const before = await this.repository.read(context.scope, owner, input.memoryId);
    if (!before) return unavailable();
    await this.authorizeRequest(context, { action: input.operation, scope: context.scope, owner, memory: before });
    const receipt = await this.repository.operation(context.scope, owner, input.memoryId, operationId);
    if (receipt && receipt.fingerprint !== operationFingerprint(context, ['change', input])) throw new KnowledgeError('conflict');
    const after = await this.repository.read(context.scope, owner, input.memoryId);
    if (fingerprint(before) !== fingerprint(after)) throw new KnowledgeError('conflict');
    await this.authorizeRequest(context, { action: input.operation, scope: context.scope, owner, memory: before });
    return { memoryId: input.memoryId, operationId, revision: before.revision,
      status: receipt ? before.revision === input.expectedRevision + 1 ? 'committed_current' as const : 'committed_superseded' as const
        : 'not_recorded' as const,
      // Absence of a receipt never authorizes a blind retry after an unknown commit.
      nextStep: receipt ? 'read_current' as const : 'reconcile_original_operation' as const };
  }

  /** Reconciliation material for an interrupted memory operation. Absence of
   * a receipt is deliberately reported as unknown, never as proof that the
   * durable write did not happen. This observes a key, NOT the operation payload:
   * changeStatus/confirmationStatus must verify the original command. Absence
   * never authorizes blind replay; this method never creates a record. */
  async operationRecovery(value: unknown) {
    const input = parse(z.object({ memoryId: id, operationId: id.max(110), expectedRevision: z.number().int().min(1).max(4294967293),
      operation: z.enum(['propose', 'modify', 'confirm', 'revoke', 'delete']) }).strict(), value);
    const context = await this.current(), owner = actor(context);
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner });
    const before = await this.repository.read(context.scope, owner, input.memoryId);
    if (!before) return unavailable();
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner, memory: before });
    const receipt = await this.repository.operation(context.scope, owner, input.memoryId, input.operationId);
    const after = await this.repository.read(context.scope, owner, input.memoryId);
    if (!after || fingerprint(before) !== fingerprint(after)) throw new KnowledgeError('conflict');
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner, memory: after });
    return { memoryId: input.memoryId, operationId: input.operationId, requestedOperation: input.operation,
      receipt: receipt ? 'recorded' as const : 'unknown' as const,
      binding: 'key_only_not_command_attestation' as const,
      current: { status: after.status, revision: after.revision, expiresAt: after.expiresAt },
      nextStep: receipt ? 'reconcile_recorded_operation' as const : 'reconcile_same_operation' as const,
      absenceSemantics: 'no_receipt_is_not_proof_of_non_execution' as const };
  }

  async confirmationRecovery(value: unknown) {
    const result = await this.confirmationStatus(value);
    const nextStep = { not_created: 'explicit_human_confirm', confirmation_saved: 'resume_same_operation',
      confirmed: 'read_current', invalidated: 'review_current_preference', unknown: 'reconcile_same_operation' } as const;
    return { ...result, nextStep: nextStep[result.status] };
  }

  async propose(value: unknown): Promise<AiMemoryDraft> {
    // Preserve the human's original proposal across current-identity awaits.
    // Validation and operation binding still belong to StructuredMemoryService.
    let input: unknown;
    try { input = structuredClone(value); }
    catch { throw new KnowledgeError('invalid_input'); }
    return this.memory.propose(await this.current(), input);
  }

  async previewChange(value: unknown) {
    const input = parse(z.object({ memoryId: id, expectedRevision: z.number().int().min(1).max(4294967293),
      preference: preferenceSchema }).strict(), value);
    const context = await this.current();
    const before = await this.memory.read(context, input.memoryId);
    if (before.status === 'deleted' || before.revision !== input.expectedRevision) throw new KnowledgeError('conflict');
    await this.authorizeRequest(context, { action: 'modify', scope: context.scope, owner: actor(context), memory: before });
    const after = await this.memory.read(context, input.memoryId);
    if (fingerprint(before) !== fingerprint(after)) throw new KnowledgeError('conflict');
    await this.authorizeRequest(context, { action: 'modify', scope: context.scope, owner: actor(context), memory: after });
    return { memoryId: before.memoryId, revision: before.revision, expiresAt: before.expiresAt,
      current: structuredClone(before.preference), candidate: input.preference,
      changed: fingerprint(before.preference) !== fingerprint(input.preference),
      nextStep: 'modify_then_explicit_human_confirmation' as const, writePerformed: false as const };
  }

  async confirmedPreferences(value: unknown) {
    const input = parse(z.object({ limit: z.number().int().min(1).max(50) }).strict(), value);
    const context = await this.current();
    if (context.scope.kind !== 'workspace') return unavailable();
    const scope = context.scope, owner = actor(context);
    await this.authorizeRequest(context, { action: 'read', scope, owner });
    requiredPort(this.ports.db.aiStructuredMemory, ['findMany']);
    const rows = await this.ports.db.aiStructuredMemory.findMany({ where: {
      tenantId: scope.tenantId, workspaceId: scope.workspaceId, subjectType: owner.actorKind, subjectId: owner.actorId,
      ownerKind: owner.actorKind, ownerId: owner.actorId, status: 'confirmed', expiresAt: { gt: new Date(this.ports.clock.now()) } },
      select: { id: true, tenantId: true, workspaceId: true, ownerKind: true, ownerId: true }, orderBy: { id: 'asc' }, take: 101 }).catch(() => unavailable());
    if (!Array.isArray(rows) || rows.length > 100) return unavailable();
    const values: Array<Extract<AiMemoryDraft, { status: 'confirmed' }>> = [], seen = new Set<string>();
    for (const row of rows) {
      if (!id.safeParse(row.id).success || seen.has(row.id) || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.ownerKind !== owner.actorKind || row.ownerId !== owner.actorId) return unavailable();
      seen.add(row.id);
      try {
        // Existing read rechecks resource permission AND current confirmation;
        // owner matching and the indexed status column are not sufficient.
        const memory = await this.memory.read(context, row.id);
        if (memory.status === 'confirmed') values.push(memory);
      } catch (error) {
        if (!(error instanceof KnowledgeError) || error.code !== 'unavailable') throw error;
        // Another audience, revoked consent or denied item is not exposed.
      }
    }
    const selected = values.slice(0, input.limit);
    for (const memory of selected) {
      const fresh = await this.memory.read(context, memory.memoryId);
      if (fingerprint(fresh) !== fingerprint(memory)) return unavailable();
    }
    await this.authorizeRequest(context, { action: 'read', scope, owner });
    const items = selected.map(memory => ({ memoryId: memory.memoryId, revision: memory.revision,
      aclRevision: memory.aclRevision, expiresAt: memory.expiresAt, preference: memory.preference,
      confirmationRecordId: memory.confirmationRecordId }));
    return { items, ambiguities: preferenceAmbiguities(items), ambiguityCoverage: 'returned_items_only' as const,
      businessCompatibility: 'unavailable' as const, truncated: values.length > input.limit,
    coverage: 'bounded_window' as const, pagination: 'unavailable' as const, semantics: 'preference_not_authority' as const };
  }

  /** Selection is explicit: an absent/empty kind list is not permission to
   * inject every preference into a model input. */
  async selectPreferences(value: unknown) {
    const input = parse(preferenceSelectionInput, value);
    if (new Set(input.kinds).size !== input.kinds.length) throw new KnowledgeError('invalid_input');
    const context = await this.current();
    const listed = await this.confirmedPreferences({ limit: 50 });
    const items = listed.items.filter(item => input.kinds.includes(item.preference.kind)).slice(0, input.limit);
    if (identityKey(await this.current()) !== identityKey(context) || context.scope.kind !== 'workspace') return unavailable();
    const selection = { ...input, requestedKinds: input.kinds, scope: structuredClone(context.scope), owner: actor(context), audience: context.audience,
      items, truncated: listed.truncated || items.length < listed.items.filter(item => input.kinds.includes(item.preference.kind)).length,
      semantics: 'explicit_preference_selection_not_authority' as const, ambiguities: preferenceAmbiguities(items),
      ambiguityCoverage: 'returned_items_only' as const, businessCompatibility: 'unavailable' as const };
    return this.revalidateSelection(selection);
  }

  /** Same observed values only. A revoked/changed preference is not silently
   * replaced with its latest value; this is input material, never a grant. */
  async revalidateSelection(value: unknown) {
    const selection = parse(preferenceSelectionSnapshot, value), context = await this.current(), owner = actor(context);
    if (!sameScope(context.scope, selection.scope) || fingerprint(owner) !== fingerprint(selection.owner)
      || context.audience !== selection.audience || selection.items.length > selection.limit
      || fingerprint(selection.requestedKinds) !== fingerprint(selection.kinds)
      || fingerprint(selection.ambiguities) !== fingerprint(preferenceAmbiguities(selection.items))
      || new Set(selection.kinds).size !== selection.kinds.length
      || new Set(selection.items.map(item => item.memoryId)).size !== selection.items.length) return unavailable();
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner });
    for (const item of selection.items) {
      if (!selection.kinds.includes(item.preference.kind)) return unavailable();
      const fresh = await this.memory.read(context, item.memoryId);
      if (fresh.status !== 'confirmed' || fresh.revision !== item.revision || fresh.aclRevision !== item.aclRevision
        || fresh.confirmationRecordId !== item.confirmationRecordId || fresh.expiresAt !== item.expiresAt
        || fingerprint(fresh.preference) !== fingerprint(item.preference)) return unavailable();
    }
    await this.authorizeRequest(context, { action: 'read', scope: context.scope, owner });
    return selection;
  }

  /** Editing invalidates the old consent; deletion uses the existing tombstone.
   * The human facade has no arbitrary confirmationId consumption shortcut.
   */
  async change(operationId: string, value: unknown): Promise<AiMemoryDraft> {
    let input: unknown;
    try { input = structuredClone(value); } catch { throw new KnowledgeError('invalid_input'); }
    if (!input || typeof input !== 'object' || !('operation' in input)
      || !['modify', 'delete'].includes(String(input.operation))) throw new KnowledgeError('invalid_input');
    // Identity resolution may wait. Never allow the caller to replace this
    // explicit human edit/delete with another operation or confirmation ID.
    const context = await this.current();
    const memory = new StructuredMemoryService({
      repository: { read: this.repository.read.bind(this.repository), operation: this.repository.operation.bind(this.repository),
        commit: command => this.commitSourceChange(context, command) },
      confirmations: this.repository, authorization: { authorize: (current, request) => this.authorizeRequest(current, request) },
      clock: this.ports.clock,
    });
    return memory.change(context, operationId, input);
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
        await lockRetentionSourceScope(tx, context.scope);
        const repository = this.transactionRepository(tx);
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
        // Revocation retains the preference and confirmation text. It stops
        // current reuse immediately even when an original effect needs its
        // body as evidence; physical delete/modify use sourceChangeReady.
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
      if (callbackCompleted) throw new KnowledgeCommitUnknownError();
      if (error instanceof KnowledgeError) throw error;
      if (!callbackCompleted && error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new KnowledgeError('conflict');
      if (attempted) throw new KnowledgeCommitUnknownError();
      return unavailable();
    }
  }

  async confirmationStatus(value: unknown) {
    const input = parse(inputSchema, value), context = await this.current();
    await this.authorize(context);
    if (context.scope.kind !== 'workspace') return unavailable();
    const scope = context.scope, owner = actor(context);
    try {
      const memory = await this.repository.read(scope, owner, input.memoryId);
      if (!memory) return unavailable();
      await this.authorize(context, memory);
      const row = await this.ports.db.aiHumanConfirmation.findFirst({ where: { tenantId: scope.tenantId,
        workspaceId: scope.workspaceId, idempotencyKey: input.operationId } });
      const base = { memoryId: input.memoryId, operationId: input.operationId };
      if (memory.status === 'deleted' || Date.parse(memory.expiresAt) <= this.ports.clock.now()) return { ...base, status: 'invalidated' as const };
      if (!row) {
        const fresh = await this.repository.read(scope, owner, input.memoryId);
        await this.authorize(context, fresh ?? undefined);
        if (!fresh || fingerprint(fresh) !== fingerprint(memory)) return { ...base, status: 'unknown' as const };
        return { ...base, status: memory.status === 'proposed' && memory.revision === input.expectedRevision ? 'not_created' as const : 'invalidated' as const };
      }
      const proof = await this.repository.read(context, row.id);
      if (!proof || proof.status !== 'confirmed' || proof.memoryId !== input.memoryId || proof.revision !== input.expectedRevision
        || proof.expiresAt !== input.expiresAt || Date.parse(proof.expiresAt) <= this.ports.clock.now()
        || proof.aclRevision !== memory.aclRevision || fingerprint(proof.preference) !== fingerprint(memory.preference)
        || proof.memoryExpiresAt !== memory.expiresAt) return { ...base, status: 'invalidated' as const };
      const change = { draftVersion: AI_KNOWLEDGE_DRAFT_VERSION, memoryId: input.memoryId, expectedRevision: input.expectedRevision,
        operation: 'confirm', confirmationRecordId: proof.id };
      const receipt = await this.repository.operation(scope, owner, input.memoryId, `${input.operationId}_memory`);
      const fresh = await this.repository.read(scope, owner, input.memoryId);
      await this.authorize(context, fresh ?? undefined);
      const currentProof = await this.repository.read(context, proof.id);
      if (!fresh || fingerprint(fresh) !== fingerprint(memory) || fingerprint(currentProof) !== fingerprint(proof)) return { ...base, status: 'unknown' as const };
      if (receipt && receipt.fingerprint !== operationFingerprint(context, ['change', change])) throw new KnowledgeError('conflict');
      if (memory.status === 'confirmed' && memory.revision === input.expectedRevision + 1 && memory.confirmationRecordId === proof.id && receipt)
        return { ...base, status: 'confirmed' as const, confirmationRecordId: proof.id };
      if (memory.status === 'proposed' && memory.revision === input.expectedRevision && !receipt)
        return { ...base, status: 'confirmation_saved' as const, confirmationRecordId: proof.id };
      return { ...base, status: 'invalidated' as const };
    } catch (error) {
      if (error instanceof KnowledgeError) throw error;
      // A failed read cannot prove the absence of a committed confirmation.
      return { memoryId: input.memoryId, operationId: input.operationId, status: 'unknown' as const };
    } finally {
      await this.authorize(context);
    }
  }

  async resumeConfirmation(value: unknown): Promise<AiMemoryDraft> {
    const input = parse(inputSchema, value), state = await this.confirmationStatus(input);
    if (state.status === 'unknown') throw new KnowledgeCommitUnknownError();
    if (state.status === 'not_created') throw new KnowledgeError('not_ready');
    if (state.status === 'invalidated') throw new KnowledgeError('conflict');
    // The second lookup is existing-only; a missing proof during the gap cannot
    // manufacture a new confirmation ID.
    return this.completeConfirmation(input, true);
  }

  async confirm(value: unknown): Promise<AiMemoryDraft> {
    return this.completeConfirmation(value, false);
  }

  private async completeConfirmation(value: unknown, existingOnly: boolean): Promise<AiMemoryDraft> {
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
          aiStructuredMemory: tx.aiStructuredMemory, aiMemoryOperation: tx.aiMemoryOperation, aiHumanConfirmation: tx.aiHumanConfirmation,
          aiDataErasure: tx.aiDataErasure },
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
        if (existingOnly) throw new KnowledgeCommitUnknownError();
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
