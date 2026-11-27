/** Owner-scoped conversation and original-request storage for the registered
 * public scene. A turn holds only the original request locator, never a body. */
import { randomUUID } from 'node:crypto';
import type { AiConversation, AiConversationOperation, AiConversationTurn, AiTaskOriginalRequest, PrismaClient } from '@prisma/client';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { isGatewayConfig } from '@rental-os/platform-server/ai-gateway';
import { AI_CONVERSATION_DRAFT_VERSION as version } from '@rental-os/platform-contracts/ai-original-result';
import { publicTextOriginalReference } from '@rental-os/platform-contracts/ai-work-center';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';
import { aiTaskHasUnresolvedEffects } from '../runtime/task-unresolved-effects';
import { SCENE, SCENE_VERSION, REQUEST_VERSION, WorkCenterUnknownError, conflict, creationKey, denied, inputRequest,
  originalPayload, owner, retentionMs, transactionOptions, unavailable, type BoundAuthority, type Owner, type SceneInput, type ScenePolicy, type Tx } from './scene';

export type ConversationDatabase = Pick<PrismaClient, '$transaction' | '$queryRaw' | 'aiScope' | 'aiConversation' | 'aiConversationOperation'
  | 'aiConversationTurn' | 'aiTaskOriginalRequest' | 'aiTask' | 'aiRun'>;
type Ref = { conversationId: string };
type TurnRef = Ref & { admissionKey: string };
type Mutation = Ref & { expectedRevision: number; operationKey: string };
type HeadOp = 'create' | 'archive' | 'delete' | 'release_turn';
type ConversationReaders = Pick<Tx, 'aiConversation' | 'aiConversationOperation' | 'aiConversationTurn' | 'aiTaskOriginalRequest' | 'aiTask' | 'aiRun'>;
const scoped = ({ scopeId, ownerId }: Owner) => ({ scopeId, ownerId });
const requestOwner = (scope: Owner) => ({ ...scoped(scope), audience: 'OPERATOR' as const, ownerKind: 'USER' as const });
const observation = { taskCancellation: 'not_requested' as const, businessRecords: 'not_modified' as const };
const summary = (row: AiConversation) => ({ conversationId: row.id, capabilityCode: SCENE, revision: row.revision,
  status: row.status, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const operationReceipt = (row: AiConversationOperation) => ({ draftVersion: version, operationKey: row.operationKey,
  status: 'observed' as const, retryable: false as const, conversationId: row.conversationId, revision: row.revision,
  operation: row.operation, ...observation });
const contentHash = (row: Pick<AiTaskOriginalRequest, 'scopeId' | 'ownerId' | 'requestKey' | 'policyRevision' | 'policyHash' | 'authorizationBindingHash'>, payload: unknown) => hash({
  version: REQUEST_VERSION, sceneCode: SCENE, sceneVersion: SCENE_VERSION, scopeId: row.scopeId, ownerId: row.ownerId,
  requestKey: row.requestKey, policyRevision: row.policyRevision, policyHash: row.policyHash,
  authorizationBindingHash: row.authorizationBindingHash, payload
});

export class WorkCenterConversations {
  constructor(private readonly db: ConversationDatabase, private readonly authority: BoundAuthority, private readonly clock: () => Date) {}

  async current(tx?: Tx) {
    const context = await (tx ? this.authority.principalOn(tx) : this.authority.identities.resolve());
    return owner(tx ?? this.db, context);
  }
  async same(before: Owner, tx?: Tx) {
    if (hash(await this.current(tx)) !== hash(before)) throw denied();
  }
  async mutate<T>(scope: Owner, run: (tx: Tx, mark: () => void) => Promise<T>) {
    let attempted = false, mayHaveCommitted = false;
    try {
      const result = await this.db.$transaction(async tx => {
        await this.same(scope, tx);
        const value = await run(tx, () => { attempted = true; });
        await this.same(scope, tx);
        mayHaveCommitted = attempted;
        return value;
      }, transactionOptions);
      await this.same(scope);
      return result;
    } catch (error) {
      if (mayHaveCommitted) throw new WorkCenterUnknownError();
      throw error;
    }
  }
  async row(db: ConversationReaders, scope: Owner, ref: Ref) {
    const row = await db.aiConversation.findFirst({ where: { ...scoped(scope), id: ref.conversationId, capabilityCode: SCENE, deletedAt: null } });
    if (!row || row.id !== ref.conversationId || row.scopeId !== scope.scopeId || row.ownerId !== scope.ownerId
      || row.capabilityCode !== SCENE || row.deletedAt !== null || !['active', 'archived'].includes(row.status)) throw unavailable();
    return row;
  }
  private async observed(db: ConversationReaders, scope: Owner, operationKey: string) {
    const row = await db.aiConversationOperation.findUnique({ where: { scopeId_ownerId_operationKey: { ...scoped(scope), operationKey } } });
    if (row && (row.scopeId !== scope.scopeId || row.ownerId !== scope.ownerId || row.operationKey !== operationKey
      || !['create', 'archive', 'delete', 'release_turn'].includes(row.operation))) throw unavailable();
    return row;
  }
  async operation(operationKey: string) {
    const scope = await this.current(), row = await this.observed(this.db, scope, operationKey);
    await this.same(scope);
    return row ? operationReceipt(row) : { draftVersion: version, operationKey, status: 'not_observed' as const,
      nextAction: 'read_original_operation' as const, absence: 'not_proof_of_no_commit' as const, retryable: false as const };
  }
  async readOriginal(inputRef: string, db: ConversationReaders = this.db, scope?: Owner): Promise<{ row: AiTaskOriginalRequest; payload: SceneInput }> {
    const who = scope ?? await this.current();
    const row = await db.aiTaskOriginalRequest.findFirst({ where: { ...requestOwner(who), id: inputRef, sceneCode: SCENE, sceneVersion: SCENE_VERSION,
      contractVersion: REQUEST_VERSION } });
    if (!row || row.id !== inputRef || row.scopeId !== who.scopeId || row.ownerId !== who.ownerId || row.audience !== 'OPERATOR'
      || row.ownerKind !== 'USER' || row.sceneCode !== SCENE || row.sceneVersion !== SCENE_VERSION || row.contractVersion !== REQUEST_VERSION
      || row.revision !== 1 || row.previousRequestId !== null || row.status !== 'STORED') throw unavailable();
    // The legacy erasure receipt requires a business workspace. Until a public
    // tenant tombstone can be verified, an erased row cannot be projected here.
    if (row.erasedAt) throw unavailable();
    const parsed = originalPayload.safeParse(row.payload);
    if (!parsed.success || !isGatewayConfig(parsed.data.configuration) || parsed.data.configuration.serviceMode !== 'tenant_managed'
      || parsed.data.configuration.tenantId !== who.tenantId || row.policyRevision !== parsed.data.policyRevision
      || contentHash(row, parsed.data) !== row.contentHash) throw unavailable();
    return { row, payload: { ...parsed.data, configuration: parsed.data.configuration } };
  }
  async originalForTurn(ref: TurnRef) {
    const scope = await this.current(), head = await this.row(this.db, scope, ref);
    const row = await this.db.aiConversationTurn.findFirst({ where: { ...scoped(scope), conversationId: head.id, admissionKey: ref.admissionKey } });
    if (!row || row.admissionKey !== ref.admissionKey) throw unavailable();
    const turn = await this.turn(this.db, scope, head, row);
    const source = await this.readOriginal(turn.original.inputRef, this.db, scope);
    if ((await this.row(this.db, scope, ref)).revision !== head.revision) throw conflict();
    await this.same(scope);
    return { scope, head, turn, ...source };
  }

  async assertCreationOpen(tx: Tx, scope: Owner, row: AiTaskOriginalRequest) {
    await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_task_original_requests WHERE scopeId = ${scope.scopeId} AND id = ${row.id} FOR UPDATE`);
    const { row: original } = await this.readOriginal(row.id, tx, scope);
    const turn = await tx.aiConversationTurn.findUnique({ where: { scopeId_originalRequestId: { scopeId: scope.scopeId, originalRequestId: row.id } } });
    if (!turn) throw denied();
    const head = await this.row(tx, scope, turn);
    if (original.contentHash !== row.contentHash || original.creationClosedAt || original.creationCloseKey || head.status !== 'active'
      || head.activeTurnId !== turn.id) throw denied();
    await this.turn(tx, scope, head, turn);
  }

  async closeTurn(tx: Tx, scope: Owner, head: AiConversation, operationKey: string) {
    if (!head.activeTurnId) throw conflict();
    const turn = await tx.aiConversationTurn.findFirst({ where: { ...scoped(scope), conversationId: head.id, id: head.activeTurnId } });
    if (!turn || turn.id !== head.activeTurnId) throw unavailable();
    await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_task_original_requests WHERE scopeId = ${scope.scopeId} AND id = ${turn.originalRequestId} FOR UPDATE`);
    const current = await this.turn(tx, scope, head, turn);
    if (current.task) {
      const taskId = current.task.taskId;
      await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_tasks WHERE scopeId = ${scope.scopeId} AND id = ${taskId} FOR UPDATE`);
      if (await aiTaskHasUnresolvedEffects(tx, scope.scopeId, taskId, { kind: 'TENANT', tenantId: scope.tenantId, workspaceId: null })) throw conflict();
      return;
    }
    // Absence alone is not a release: record the permanent creation fence on
    // the exact original row, under the same lock used by Task creation.
    const { row } = await this.readOriginal(turn.originalRequestId, tx, scope);
    if (await tx.aiTask.findFirst({ where: { scopeId: scope.scopeId, OR: [{ inputRef: row.id }, { creationKey: creationKey(row.id) }] },
      select: { id: true } })) throw conflict();
    if ((await tx.aiTaskOriginalRequest.updateMany({ where: { ...requestOwner(scope), id: row.id, revision: row.revision,
      contentHash: row.contentHash, creationClosedAt: null, creationCloseKey: null, erasedAt: null },
    data: { creationClosedAt: this.clock(), creationCloseKey: operationKey } })).count !== 1) throw conflict();
  }
  private async turn(db: ConversationReaders, scope: Owner, head: AiConversation, row: AiConversationTurn) {
    if (row.scopeId !== scope.scopeId || row.ownerId !== scope.ownerId || row.conversationId !== head.id || row.capabilityCode !== SCENE
      || row.capabilityVersion !== SCENE_VERSION || row.inputHash !== hash(inputRequest) || row.admissionRevision >= head.revision) throw unavailable();
    const { row: original } = await this.readOriginal(row.originalRequestId, db, scope);
    if (original.requestKey !== row.originalRequestKey || Boolean(original.creationClosedAt) !== Boolean(original.creationCloseKey)
      || original.creationClosedAt && original.creationClosedAt > this.clock()) throw unavailable();
    const task = await db.aiTask.findFirst({ where: { ...requestOwner(scope), scopeKind: 'TENANT', creationKey: creationKey(original.id) },
      select: { id: true, scopeId: true, scopeKind: true, audience: true, ownerKind: true, ownerId: true, inputRef: true, inputHash: true, inputRevision: true,
        sceneCode: true, sceneVersion: true, archivedAt: true, runs: { where: { sequence: 1 }, select: { id: true, scopeId: true, taskId: true }, take: 2 } } });
    if (task && (task.scopeId !== scope.scopeId || task.ownerId !== scope.ownerId || task.scopeKind !== 'TENANT' || task.audience !== 'OPERATOR'
      || task.ownerKind !== 'USER' || task.inputRef !== original.id || task.inputHash !== original.contentHash || task.inputRevision !== original.revision
      || task.sceneCode !== SCENE || task.sceneVersion !== SCENE_VERSION || task.archivedAt !== null || task.runs.length !== 1
      || task.runs[0].scopeId !== scope.scopeId || task.runs[0].taskId !== task.id)) throw unavailable();
    if (task && (original.creationClosedAt || original.creationCloseKey)) throw unavailable();
    return { admissionKey: row.admissionKey, turnId: row.id, originalRequestKey: row.originalRequestKey,
      requestHash: row.inputHash, capabilityCode: SCENE, capabilityVersion: SCENE_VERSION, createdAt: row.createdAt.toISOString(),
      automaticRetry: false as const, status: 'original_bound' as const, original: publicTextOriginalReference(original.id),
      execution: 'not_inferred_from_association' as const, material: 'retained' as const,
      creation: original.creationClosedAt ? 'permanently_closed' as const : 'available_for_review' as const,
      task: task ? { taskId: task.id, runId: task.runs[0].id } : null };
  }

  private async visibleTurn(scope: Owner, head: AiConversation, row: AiConversationTurn) {
    const value = await this.turn(this.db, scope, head, row);
    // The original association does not confer the Task's independent read
    // grant. Release still inspects the underlying row to preserve its hold.
    if (value.task) await this.authority.actions.resolve(value.task.taskId, 'read_metadata');
    return value;
  }
  async admission(ref: TurnRef) {
    const scope = await this.current(), head = await this.row(this.db, scope, ref);
    const row = await this.db.aiConversationTurn.findFirst({ where: { ...scoped(scope), conversationId: head.id, admissionKey: ref.admissionKey } });
    if (row && row.admissionKey !== ref.admissionKey) throw unavailable();
    const result = row ? await this.visibleTurn(scope, head, row) : null;
    if ((await this.row(this.db, scope, ref)).revision !== head.revision) throw conflict();
    await this.same(scope);
    return { draftVersion: version, conversationId: head.id, admissionKey: ref.admissionKey, result,
      absence: 'not_proof_of_no_commit' as const, retryable: false as const };
  }
  async read(ref: Ref) {
    const scope = await this.current(), row = await this.row(this.db, scope, ref);
    const current = row.activeTurnId ? await this.db.aiConversationTurn.findFirst({ where: { ...scoped(scope), conversationId: row.id, id: row.activeTurnId } }) : null;
    if (row.activeTurnId && (!current || current.id !== row.activeTurnId)) throw unavailable();
    const currentTurn = current ? await this.visibleTurn(scope, row, current) : null;
    if ((await this.row(this.db, scope, ref)).revision !== row.revision) throw conflict();
    await this.same(scope);
    return { draftVersion: version, ...summary(row), currentTurn, taskCancellation: 'separate_original_operation', businessRecords: 'not_modified' };
  }
  async list(query: { status: 'active' | 'archived'; limit: number; beforeId?: string }) {
    const scope = await this.current();
    const where = { ...scoped(scope), status: query.status, capabilityCode: SCENE, deletedAt: null };
    const before = query.beforeId ? await this.db.aiConversation.findFirst({ where: { ...where, id: query.beforeId } }) : null;
    if (query.beforeId && (!before || before.id !== query.beforeId)) throw unavailable();
    const rows = await this.db.aiConversation.findMany({ where: { ...where, ...(before ? { OR: [{ createdAt: { lt: before.createdAt } },
      { createdAt: before.createdAt, id: { lt: before.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    if (rows.some(row => row.scopeId !== scope.scopeId || row.ownerId !== scope.ownerId || row.status !== query.status
      || row.capabilityCode !== SCENE || row.deletedAt !== null)) throw unavailable();
    await this.same(scope);
    return { draftVersion: version, items: rows.slice(0, query.limit).map(summary),
      nextBeforeId: rows.length > query.limit ? rows[query.limit - 1].id : null, coverage: 'page_not_total' };
  }
  async turns(query: Ref & { limit: number; beforeId?: string }) {
    const scope = await this.current(), head = await this.row(this.db, scope, query), where = { ...scoped(scope), conversationId: head.id };
    const before = query.beforeId ? await this.db.aiConversationTurn.findFirst({ where: { ...where, id: query.beforeId } }) : null;
    if (query.beforeId && (!before || before.id !== query.beforeId)) throw unavailable();
    const rows = await this.db.aiConversationTurn.findMany({ where: { ...where, ...(before ? { OR: [{ admissionRevision: { lt: before.admissionRevision } },
      { admissionRevision: before.admissionRevision, id: { lt: before.id } }] } : {}) }, orderBy: [{ admissionRevision: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    const items = await Promise.all(rows.slice(0, query.limit).map(row => this.visibleTurn(scope, head, row)));
    if ((await this.row(this.db, scope, query)).revision !== head.revision) throw conflict();
    await this.same(scope);
    return { draftVersion: version, conversationId: head.id, items, nextBeforeId: rows.length > query.limit ? rows[query.limit - 1].id : null,
      coverage: 'page_not_total', execution: 'not_started_by_read' };
  }
  async change(operation: HeadOp, command: { operationKey: string } | Mutation, authorize?: (tx: Tx, scope: Owner, head: AiConversation | null) => Promise<void>) {
    const scope = await this.current(), inputHash = hash({ operation, command }), operationKey = command.operationKey;
    return this.mutate(scope, async (tx, mark) => {
      const existing = await this.observed(tx, scope, operationKey);
      if (existing) {
        if (existing.inputHash !== inputHash || existing.operation !== operation) throw conflict();
        return operationReceipt(existing);
      }
      let id = randomUUID() as string, revision = 1;
      const at = this.clock();
      if (operation === 'create') {
        await authorize?.(tx, scope, null);
        mark();
        await tx.aiConversation.create({ data: { id, ...scoped(scope), status: 'active', revision, capabilityCode: SCENE,
          activeTurnId: null, deletedAt: null, createdAt: at, updatedAt: at } });
      } else {
        if (!('conversationId' in command)) throw conflict();
        const row = await this.row(tx, scope, command);
        if (row.revision !== command.expectedRevision || row.revision >= 4294967294) throw conflict();
        id = row.id; revision = row.revision + 1;
        await authorize?.(tx, scope, row);
        mark();
        const modified = await tx.aiConversation.updateMany({ where: { ...scoped(scope), id, revision: row.revision, deletedAt: null, activeTurnId: row.activeTurnId },
          data: { revision, updatedAt: at, ...(operation === 'release_turn' ? { activeTurnId: null }
            : operation === 'archive' ? { status: 'archived' } : { status: 'deleted', deletedAt: at }) } });
        if (modified.count !== 1) throw conflict();
      }
      return operationReceipt(await tx.aiConversationOperation.create({ data: { ...scoped(scope), operationKey,
        conversationId: id, operation, revision, inputHash, createdAt: at } }));
    });
  }
  async admit(ref: TurnRef & { expectedRevision: number }, prepare: (scope: Owner) => Promise<{ payload: SceneInput; policy: ScenePolicy }>,
    verify: (tx: Tx, scope: Owner, prepared: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
    const scope = await this.current(), head = await this.row(this.db, scope, ref);
    const key = { ...scoped(scope), conversationId: head.id, admissionKey: ref.admissionKey };
    const prior = await this.db.aiConversationTurn.findFirst({ where: key });
    if (prior) {
      if (prior.admissionRevision !== ref.expectedRevision || prior.inputHash !== hash(inputRequest)) throw conflict();
      return this.admission(ref);
    }
    const prepared = await prepare(scope);
    await this.mutate(scope, async (tx, mark) => {
      const live = await this.row(tx, scope, ref), prior = await tx.aiConversationTurn.findFirst({ where: key });
      if (prior) {
        if (prior.admissionRevision !== ref.expectedRevision || prior.inputHash !== hash(inputRequest)) throw conflict();
        return;
      }
      if (live.status !== 'active' || live.activeTurnId || live.revision !== ref.expectedRevision || live.revision >= 4294967294) throw conflict();
      await verify(tx, scope, prepared);
      const id = randomUUID(), inputRef = randomUUID(), at = this.clock();
      const requestKey = `conversation:${hash({ ...scoped(scope), conversationId: head.id, admissionKey: ref.admissionKey })}`;
      const original = { ...requestOwner(scope), id: inputRef, requestKey, revision: 1, contractVersion: REQUEST_VERSION,
        sceneCode: SCENE, sceneVersion: SCENE_VERSION, policyRevision: prepared.policy.revision, policyHash: prepared.policy.hash,
        authorizationBindingHash: scope.binding, payload: prepared.payload as unknown as import('@prisma/client').Prisma.InputJsonValue,
        expiresAt: new Date(Math.min(prepared.policy.expiresAt.getTime(), at.getTime() + retentionMs)), createdAt: at };
      mark();
      await tx.aiTaskOriginalRequest.create({ data: { ...original, contentHash: contentHash(original, prepared.payload) } });
      if ((await tx.aiConversation.updateMany({ where: { ...scoped(scope), id: live.id, revision: live.revision, status: 'active',
        activeTurnId: null, deletedAt: null }, data: { activeTurnId: id, revision: { increment: 1 }, updatedAt: at } })).count !== 1) throw conflict();
      await tx.aiConversationTurn.create({ data: { ...key, id, admissionRevision: ref.expectedRevision, inputHash: hash(inputRequest),
        originalRequestId: inputRef, originalRequestKey: requestKey, capabilityCode: SCENE, capabilityVersion: SCENE_VERSION, createdAt: at } });
    });
    try { return await this.admission(ref); } catch { throw new WorkCenterUnknownError(); }
  }
}
