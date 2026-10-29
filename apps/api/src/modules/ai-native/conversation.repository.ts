/** Operator-owned conversation metadata and atomic original-request admission.
 * No message/body copy, model call, plan publication or budget reset. Delete
 * hides history only; original Task/Artifact, holds and business receipts stay.
 * An occupied turn cannot be replaced without a separate trusted completion. */
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AI_CONVERSATION_DRAFT_VERSION as version, AI_SCENE_REQUEST_DRAFT_VERSION,
  AI_TASK_CENTER_ENTRY_PERMISSIONS, type AiSceneCode, type AiConversationObservationDraft,
  type AiConversationOperationObservationDraft, type AiConversationTurnObservationDraft,
  type AiConversationListResponseDraft, type AiConversationTurnPageDraft, type AiConversationAdmissionResponseDraft,
  type AiConversationModelResultResponseDraft } from '@rental-os/shared';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { AiTaskRepositoryError } from './ai-task.repository';
import { originalIdentityHash } from './task-request/original-request.authority';
import { PrismaOriginalRequestRepository, AiOriginalRequestResultUnknownError } from './task-request/prisma-original-request.repository';
import type { AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { conversationCommand } from './conversation-contract';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { aiTaskHasUnresolvedEffects } from './task-unresolved-effects';
import { validateAiSceneModelObservation } from './scenes/scene-observation-contracts';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
type Conversation = Prisma.AiConversationGetPayload<{}>;
type Turn = Prisma.AiConversationTurnGetPayload<{}>;
type Operation = Prisma.AiConversationOperationGetPayload<{}>;
type Session = { scopeId: string; ownerId: string; tenantId: string; workspaceId: string; binding: string };
const transaction = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 };

export class AiConversationRepository {
  private readonly scopes: AiScopeRepository;
  private readonly clock: () => Date;
  private readonly capabilities: readonly string[];
  private readonly db: PrismaClient;
  constructor(input: AiOriginalSceneDependencies, private readonly originals: PrismaOriginalRequestRepository) {
    this.clock = input.clock ?? (() => new Date()); this.db = input.db;
    this.scopes = new AiScopeRepository(input.db, new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, this.clock), this.clock);
    this.capabilities = input.creationRules.filter(rule => rule.audiences.includes('operator')).map(rule => rule.sceneCode);
  }
  private now() {
    const at = this.clock();
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw unavailable();
    return at;
  }
  private async current(): Promise<Session> {
    const { context, scope } = await this.scopes.resolveCurrent();
    if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
      || !('access' in context) || !AI_TASK_CENTER_ENTRY_PERMISSIONS.some(code => context.access.permissions.includes(code))) throw denied();
    return { scopeId: scope.id, ownerId: context.actor.userId, tenantId: context.scope.tenantId,
      workspaceId: context.scope.workspaceId, binding: originalIdentityHash(context) };
  }
  private owner(session: Session) { return { scopeId: session.scopeId, ownerId: session.ownerId }; }
  private async check(session: Session) {
    const current = await this.current();
    if (requestFingerprint(session) !== requestFingerprint(current)) throw denied();
  }
  private async row(db: Pick<Prisma.TransactionClient, 'aiConversation'>, session: Session, id: string) {
    const row = await db.aiConversation.findFirst({ where: { ...this.owner(session), id } });
    if (!row || row.id !== id || row.scopeId !== session.scopeId || row.ownerId !== session.ownerId
      || row.deletedAt || !['active', 'archived'].includes(row.status) || !this.capabilities.includes(row.capabilityCode)) throw unavailable();
    return row;
  }
  private summary(row: Conversation) {
    return { conversationId: row.id, revision: row.revision, capabilityCode: row.capabilityCode as AiSceneCode,
      status: row.status as 'active' | 'archived', createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
  private operation(row: Operation): AiConversationOperationObservationDraft {
    if (!['create', 'archive', 'delete', 'release_turn'].includes(row.operation)) throw unavailable();
    return { draftVersion: version, operationKey: row.operationKey, retryable: false, status: 'observed', conversationId: row.conversationId,
      revision: row.revision, operation: row.operation as 'create' | 'archive' | 'delete' | 'release_turn', taskCancellation: 'not_requested', businessRecords: 'not_modified' };
  }
  async readOperation(value: unknown): Promise<AiConversationOperationObservationDraft> {
    const command = conversationCommand('AiConversationOperationRequestDraft', value), session = await this.current();
    const row = await this.db.aiConversationOperation.findFirst({ where: { ...this.owner(session), operationKey: command.operationKey } });
    await this.check(session);
    if (!row) return { draftVersion: version, operationKey: command.operationKey, retryable: false, status: 'not_observed',
      nextAction: 'read_original_operation', absence: 'not_proof_of_no_commit' };
    return this.operation(row);
  }
  async create(value: unknown): Promise<AiConversationOperationObservationDraft> {
    const command = conversationCommand('AiConversationCreateDraft', value), session = await this.current();
    if (!this.capabilities.includes(command.capabilityCode)) throw unavailable();
    const inputHash = requestFingerprint({ operation: 'create', command });
    let attempted = false;
    try {
      const result = await this.db.$transaction(async tx => {
        const key = { ...this.owner(session), operationKey: command.operationKey };
        const existing = await tx.aiConversationOperation.findFirst({ where: key });
        if (existing) { if (existing.inputHash !== inputHash) throw conflict(); await this.check(session); return this.operation(existing); }
        const at = this.now(), id = randomUUID();
        await this.check(session); attempted = true;
        await tx.aiConversation.create({ data: { ...this.owner(session), id, capabilityCode: command.capabilityCode,
          status: 'active', revision: 1, activeTurnId: null, deletedAt: null, createdAt: at, updatedAt: at } });
        const receipt = await tx.aiConversationOperation.create({ data: { ...key, conversationId: id, operation: 'create', inputHash, revision: 1, createdAt: at } });
        await this.check(session);
        return this.operation(receipt);
      }, transaction);
      await this.check(session);
      return result;
    } catch (error) {
      if (attempted) throw new AiOriginalRequestResultUnknownError();
      throw error;
    }
  }
  async mutate(value: unknown, operation: 'archive' | 'delete'): Promise<AiConversationOperationObservationDraft> {
    const command = conversationCommand('AiConversationMutationDraft', value), session = await this.current();
    if (!['archive', 'delete'].includes(operation)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const inputHash = requestFingerprint({ operation, command });
    let attempted = false;
    try {
      const result = await this.db.$transaction(async tx => {
        const key = { ...this.owner(session), operationKey: command.operationKey };
        const existing = await tx.aiConversationOperation.findFirst({ where: key });
        if (existing) { if (existing.inputHash !== inputHash) throw conflict(); await this.check(session); return this.operation(existing); }
        const row = await this.row(tx, session, command.conversationId);
        if (row.revision !== command.expectedRevision || row.revision >= 4294967294) throw conflict();
        const at = this.now(); await this.check(session);
        const changed = await tx.aiConversation.updateMany({ where: { ...this.owner(session), id: row.id, revision: row.revision, deletedAt: null },
          data: { revision: { increment: 1 }, status: operation === 'delete' ? 'deleted' : 'archived', updatedAt: at,
            ...(operation === 'delete' ? { deletedAt: at } : {}) } });
        if (changed.count !== 1) throw conflict(); attempted = true;
        const receipt = await tx.aiConversationOperation.create({ data: { ...key, conversationId: row.id, operation, inputHash,
          revision: row.revision + 1, createdAt: at } });
        await this.check(session); return this.operation(receipt);
      }, transaction);
      await this.check(session); return result;
    } catch (error) { if (attempted) throw new AiOriginalRequestResultUnknownError(); throw error; }
  }
  /** Release only an observed terminal original task with no unresolved effect
   * or accounting hold. Timeout/absence/expiry never frees the conversation. */
  async releaseTurn(value: unknown): Promise<AiConversationOperationObservationDraft> {
    const command = conversationCommand('AiConversationMutationDraft', value), session = await this.current();
    const inputHash = requestFingerprint({ operation: 'release_turn', command });
    const key = { ...this.owner(session), operationKey: command.operationKey };
    const existing = await this.db.aiConversationOperation.findFirst({ where: key });
    if (existing) { if (existing.inputHash !== inputHash) throw conflict(); await this.check(session); return this.operation(existing); }
    let attempted = false;
    try {
      const result = await this.db.$transaction(async tx => {
        // A competing same-key release can commit after the first receipt read.
        // Return that original fact before inspecting the now-changed head.
        const replay = await tx.aiConversationOperation.findFirst({ where: key });
        if (replay) { if (replay.inputHash !== inputHash) throw conflict(); await this.check(session); return this.operation(replay); }
        const row = await this.row(tx, session, command.conversationId);
        if (!row.activeTurnId || row.revision !== command.expectedRevision || row.revision >= 4294967294) throw conflict();
        const turn = await tx.aiConversationTurn.findFirst({ where: { ...this.owner(session), conversationId: row.id, id: row.activeTurnId } });
        if (!turn) throw unavailable();
        const before = await this.turn(turn);
        if (!before.task) throw unavailable();
        const taskId = before.task.taskId;
        const task = await tx.aiTask.findFirst({ where: { ...this.owner(session), id: taskId, ownerKind: 'USER', audience: 'OPERATOR',
          scopeKind: 'WORKSPACE', inputRef: turn.originalRequestId, archivedAt: null } });
        if (!task || !['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)
          || await aiTaskHasUnresolvedEffects(tx, session.scopeId, taskId, { tenantId: session.tenantId, workspaceId: session.workspaceId })) throw unavailable();
        await this.check(session);
        const changed = await tx.aiConversation.updateMany({ where: { ...this.owner(session), id: row.id, revision: row.revision,
          activeTurnId: turn.id, deletedAt: null }, data: { activeTurnId: null, revision: { increment: 1 }, updatedAt: this.now() } });
        if (changed.count !== 1) throw conflict(); attempted = true;
        const receipt = await tx.aiConversationOperation.create({ data: { ...key, conversationId: row.id, operation: 'release_turn',
          inputHash, revision: row.revision + 1, createdAt: this.now() } });
        await this.check(session); return this.operation(receipt);
      }, transaction);
      await this.check(session); return result;
    } catch (error) { if (attempted) throw new AiOriginalRequestResultUnknownError(); throw error; }
  }
  async list(value: unknown): Promise<AiConversationListResponseDraft> {
    const command = conversationCommand('AiConversationListDraft', value), session = await this.current();
    const rows = await this.db.aiConversation.findMany({ where: { ...this.owner(session), status: command.status, deletedAt: null,
      ...(command.beforeId ? { id: { lt: command.beforeId } } : {}) }, orderBy: { id: 'desc' }, take: command.limit + 1 });
    await this.check(session);
    return { draftVersion: version, items: rows.slice(0, command.limit).map(row => this.summary(row)),
      nextBeforeId: rows.length > command.limit ? rows[command.limit - 1].id : null, coverage: 'page_not_total' };
  }
  private async turn(row: Turn): Promise<AiConversationTurnObservationDraft> {
    const reference = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: row.originalRequestId };
    const locator = await this.originals.readTaskLocator(reference);
    if (locator.receipt.state === 'revoked') throw denied();
    if (locator.receipt.inputRef !== row.originalRequestId || locator.receipt.requestKey !== row.originalRequestKey
      || locator.receipt.sceneCode !== row.capabilityCode || locator.receipt.sceneVersion !== row.capabilityVersion) throw unavailable();
    if (locator.material === 'retained') {
      const original = await this.originals.readHistorical(reference);
      if (requestFingerprint(original.receipt) !== requestFingerprint(locator.receipt)
        || requestFingerprint(original.request) !== row.inputHash) throw unavailable();
    }
    // Erasure has its own validated receipt and current task-read policy. It
    // attests only the original locator, never the missing body or a new grant.
    const common = { admissionKey: row.admissionKey, turnId: row.id, originalRequestKey: row.originalRequestKey, requestHash: row.inputHash,
      capabilityCode: row.capabilityCode as AiSceneCode, capabilityVersion: row.capabilityVersion, createdAt: row.createdAt.toISOString(), automaticRetry: false as const,
      status: 'original_bound' as const, original: reference, execution: 'not_inferred_from_association' as const };
    const receipt = locator.task;
    if (locator.material === 'erased') {
      if (receipt.state !== 'observed') throw unavailable();
      return { ...common, material: 'erased', task: { taskId: receipt.taskId, runId: receipt.runId } };
    }
    return { ...common, material: 'retained', task: receipt.state === 'observed' ? { taskId: receipt.taskId, runId: receipt.runId } : null };
  }
  async read(value: unknown): Promise<AiConversationObservationDraft> {
    const command = conversationCommand('AiConversationReferenceDraft', value), session = await this.current();
    const row = await this.row(this.db, session, command.conversationId);
    const turn = row.activeTurnId ? await this.db.aiConversationTurn.findFirst({ where: { ...this.owner(session), conversationId: row.id, id: row.activeTurnId } }) : null;
    if (row.activeTurnId && !turn) throw unavailable();
    const currentTurn = turn ? await this.turn(turn) : null;
    const after = await this.row(this.db, session, row.id);
    if (row.revision !== after.revision) throw conflict(); await this.check(session);
    return { draftVersion: version, ...this.summary(row), currentTurn, taskCancellation: 'separate_original_operation', businessRecords: 'not_modified' };
  }
  async turns(value: unknown): Promise<AiConversationTurnPageDraft> {
    const command = conversationCommand('AiConversationTurnListDraft', value), session = await this.current();
    const row = await this.row(this.db, session, command.conversationId);
    const turns = await this.db.aiConversationTurn.findMany({ where: { ...this.owner(session), conversationId: row.id,
      ...(command.beforeId ? { id: { lt: command.beforeId } } : {}) }, orderBy: { id: 'desc' }, take: command.limit + 1 });
    const items = [];
    for (const turn of turns.slice(0, command.limit)) items.push(await this.turn(turn));
    const after = await this.row(this.db, session, row.id); if (row.revision !== after.revision) throw conflict(); await this.check(session);
    return { draftVersion: version, conversationId: row.id, items, nextBeforeId: turns.length > command.limit ? turns[command.limit - 1].id : null,
      coverage: 'page_not_total', execution: 'not_started_by_read' };
  }
  async readAdmission(value: unknown): Promise<AiConversationAdmissionResponseDraft> {
    const command = conversationCommand('AiConversationTurnReferenceDraft', value), session = await this.current();
    const row = await this.row(this.db, session, command.conversationId);
    const turn = await this.db.aiConversationTurn.findFirst({ where: { ...this.owner(session), conversationId: row.id, admissionKey: command.admissionKey } });
    const result = turn ? await this.turn(turn) : null;
    const after = await this.row(this.db, session, row.id); if (row.revision !== after.revision) throw conflict(); await this.check(session);
    return { draftVersion: version, conversationId: row.id, admissionKey: command.admissionKey, result,
      absence: 'not_proof_of_no_commit' as const, retryable: false as const };
  }
  /** Fixed existing artifact reader supplied by server composition. Recheck the
   * original admission after it returns; no execution or reader name from wire. */
  async modelResult(value: unknown, reader: { readModelResult(value: unknown): Promise<unknown> }): Promise<AiConversationModelResultResponseDraft> {
    const command = conversationCommand('AiConversationModelResultReadDraft', value);
    const reference = { draftVersion: command.draftVersion, conversationId: command.conversationId, admissionKey: command.admissionKey };
    const before = await this.readAdmission(reference), turn = before.result;
    if (!turn?.task) throw unavailable();
    if (turn.material === 'erased') return { ...reference, turn, status: 'material_erased', result: null,
      nextAction: 'original_task_center', execution: 'read_only_no_start_no_dispatch' };
    const result = validateAiSceneModelObservation(await reader.readModelResult({ original: structuredClone(turn.original), resultId: command.resultId }));
    if (result.original.inputRef !== turn.original.inputRef || result.original.requestKey !== turn.originalRequestKey
      || result.sceneCode !== turn.capabilityCode || result.original.sceneVersion !== turn.capabilityVersion
      || result.taskId !== turn.task.taskId || result.resultId !== command.resultId) throw unavailable();
    const after = await this.readAdmission(reference);
    if (requestFingerprint(after) !== requestFingerprint(before)) throw conflict();
    return { ...reference, turn, status: 'observed', result, execution: 'read_only_no_start_no_dispatch' };
  }
  async admit(value: unknown): Promise<AiConversationAdmissionResponseDraft> {
    const command = conversationCommand('AiConversationTurnAdmissionDraft', value), session = await this.current();
    const row = await this.row(this.db, session, command.conversationId);
    if (row.capabilityCode !== command.request.sceneCode) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const inputHash = requestFingerprint(command.request);
    const prior = await this.db.aiConversationTurn.findFirst({ where: { ...this.owner(session), conversationId: row.id, admissionKey: command.admissionKey } });
    if (prior) {
      if (prior.inputHash !== inputHash || prior.admissionRevision !== command.expectedRevision) throw conflict();
      return this.readAdmission({ draftVersion: version, conversationId: row.id, admissionKey: command.admissionKey });
    }
    if (row.status !== 'active' || row.revision !== command.expectedRevision || row.activeTurnId || row.revision >= 4294967294) throw conflict();
    const requestKey = `conversation:${requestFingerprint({ ...this.owner(session), conversationId: row.id, admissionKey: command.admissionKey })}`;
    await this.originals.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey, ...command.request }, false, async (tx, receipt) => {
      const current = await this.row(tx, session, row.id);
      const existing = await tx.aiConversationTurn.findFirst({ where: { ...this.owner(session), conversationId: row.id, admissionKey: command.admissionKey } });
      if (existing) {
        if (existing.inputHash !== inputHash || existing.admissionRevision !== command.expectedRevision || existing.originalRequestId !== receipt.inputRef) throw conflict();
        await this.check(session); return;
      }
      if (current.status !== 'active' || current.revision !== command.expectedRevision || current.activeTurnId) throw conflict();
      const id = randomUUID(), at = this.now(); await this.check(session);
      const changed = await tx.aiConversation.updateMany({ where: { ...this.owner(session), id: row.id, status: 'active',
        revision: command.expectedRevision, activeTurnId: null, deletedAt: null }, data: { activeTurnId: id, revision: { increment: 1 }, updatedAt: at } });
      if (changed.count !== 1) throw conflict();
      await tx.aiConversationTurn.create({ data: { ...this.owner(session), id, conversationId: row.id, admissionKey: command.admissionKey,
        admissionRevision: command.expectedRevision, inputHash, originalRequestId: receipt.inputRef, originalRequestKey: requestKey, capabilityCode: receipt.sceneCode,
        capabilityVersion: receipt.sceneVersion, createdAt: at } });
      await this.check(session);
    });
    // A read failure after the atomic request/admission commit is unknown, not
    // a safe-to-replace send. Creating its Task remains an explicit next step.
    try { return await this.readAdmission({ draftVersion: version, conversationId: row.id, admissionKey: command.admissionKey }); }
    catch { throw new AiOriginalRequestResultUnknownError(); }
  }
}
