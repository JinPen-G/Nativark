import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext, CreateRentalOrderRequest, RentalQuoteSnapshotV1 } from '@rental-os/shared';
import { AI_QUOTE_SELECTION_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION, type AiQuoteSelectionCreateDraft, type AiQuoteSelectionReceiptDraft,
  type AiQuoteSelectionSelectResponseDraft, type AiQuoteSelectionReconcileResponseDraft, type AiQuoteSelectionOperationLocatorDraft } from '@rental-os/shared';
import type { ControlledApprovedOrderDependencies } from '../approval-execution/controlled-approved-order.composition';
import { AiApprovedOrderRouteAuthority } from '../approval-execution/approved-order-route.authority';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { PrismaOriginalRequestRepository, AiOriginalRequestResultUnknownError } from './prisma-original-request.repository';
import { originalIdentityHash } from './original-request.authority';
import { freezeOriginalInput } from './original-request.validation';
import { parseQuoteSelection, parseQuoteSelectionRead, parseQuoteSelectionProof, validateQuoteSelectionHttpRequest } from './quote-selection.validation';
import { readTaskModelRunOrigin } from '../task-input/prisma-task-input.repository';

type Row = Prisma.AiTaskQuoteSelectionGetPayload<{}>;
export type HumanQuoteSelectionDependencies = Pick<ControlledApprovedOrderDependencies,
  'db' | 'auth' | 'credentials' | 'guard' | 'confirmation' | 'quoteFacts' | 'core' | 'clock'> & { originals: PrismaOriginalRequestRepository };
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');

/** Internal failure signals only: never retain SQL, payloads, credentials or
 * Prisma meta. The non-enumerable cause is not part of the HTTP error contract. */
function selectionDiagnostic<T extends Error>(mapped: T, original: unknown, phase: string, startedAt: number): T {
  const names = ['Error', 'TypeError', 'RangeError', 'PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError',
    'PrismaClientInitializationError', 'PrismaClientValidationError', 'PrismaClientRustPanicError'];
  const errorName = original instanceof Error && names.includes(original.name) ? original.name : 'UnclassifiedError';
  const errorCode = original instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/u.test(original.code) ? original.code : undefined;
  Object.defineProperty(mapped, 'cause', { value: Object.freeze({ operation: 'quote_selection', phase,
    elapsedMs: Math.max(0, Date.now() - startedAt), errorName, ...(errorCode ? { errorCode } : {}) }), configurable: true });
  return mapped;
}

/** Freezes an explicitly selected original quote, not approval or order execution.
 * Only transaction resolution confirms persistence; callback readiness never
 * proves COMMIT, and missing receipts never authorize another selection attempt. */
export class PrismaQuoteSelectionRepository {
  private readonly identity: AiTaskCurrentIdentityAuthority;
  private readonly route: AiApprovedOrderRouteAuthority;
  private readonly clock: () => Date;
  constructor(private readonly d: HumanQuoteSelectionDependencies) {
    this.clock = d.clock ?? (() => new Date());
    this.identity = new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, this.clock);
    this.route = new AiApprovedOrderRouteAuthority(d.guard, d.credentials, this.clock);
    if (typeof d.quoteFacts?.findQuote !== 'function' || typeof d.confirmation?.normalizeOrderInput !== 'function'
      || typeof d.confirmation?.assertOrderMatchesQuote !== 'function' || typeof d.db.aiTaskQuoteSelection?.create !== 'function') throw unavailable();
  }
  private async original(inputRef: string, taskId?: string, runId?: string, active = false, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.d.db;
    const reference = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef };
    const original = active ? await this.d.originals.readHistorical(reference, tx) : await this.d.originals.readTaskLocator(reference, tx);
    const current = await this.identity.resolve();
    if (original.receipt.sceneCode !== 'quote_clarification' || current.actor.kind !== 'user' || current.scope.kind !== 'workspace'
      || originalIdentityHash(original.context) !== originalIdentityHash(current)) throw denied();
    const task = await this.d.originals.readTaskReceipt(inputRef, tx);
    if (task.state !== 'observed' || (taskId && task.taskId !== taskId)) throw unavailable();
    if (active) {
      await this.d.originals.resolve(original.receipt.sceneCode, inputRef, tx);
      if (!['queued', 'running', 'waiting_input', 'waiting_confirmation'].includes(task.status)) throw denied();
    }
    const access = aiTaskAccessFromContext(current, task.taskId, this.clock());
    const storedTask = await db.aiTask.findFirst({ where: { ...access.where, id: task.taskId }, select: { scopeId: true, inputRef: true } });
    if (!storedTask || storedTask.inputRef !== inputRef) throw denied();
    if (runId && task.runId !== runId) {
      // A persisted human answer may hand an unplanned successor to the order
      // host. It cannot mutate the completed model parent or invent ancestry.
      const lineage = async (tx: Prisma.TransactionClient) => {
        if (active || !('material' in original) || original.material !== 'erased') await readTaskModelRunOrigin(tx, access, { scopeId: storedTask.scopeId, taskId: task.taskId,
          runId, originRunId: task.runId, registrationRef: `scene-model:${inputRef}` });
        else {
          // A frozen human selection already attests its original ancestry.
          // Historical business receipts need the retained relational lineage,
          // not expired/erased model bodies or the original answers' plaintext.
          let cursor = runId, seen = new Set<string>();
          for (let count = 0; cursor !== task.runId; count++) {
            if (count >= 1000 || seen.has(cursor)) throw denied();
            seen.add(cursor);
            const run = await tx.aiRun.findFirst({ where: { scopeId: storedTask.scopeId, taskId: task.taskId, id: cursor } });
            if (!run || run.id !== cursor || run.scopeId !== storedTask.scopeId || run.taskId !== task.taskId
              || run.actorKind !== access.actorKind || run.actorId !== access.actorId
              || run.resourceOriginRunId !== task.runId || !run.inputReceiptId || run.sequence < 2) throw denied();
            const answer = await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_id: {
              scopeId: storedTask.scopeId, taskId: task.taskId, id: run.inputReceiptId } } });
            const request = answer && await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: {
              scopeId: storedTask.scopeId, taskId: task.taskId, id: answer.requestId } } });
            const parent = request && await tx.aiRun.findFirst({ where: { scopeId: storedTask.scopeId, taskId: task.taskId, id: request.runId } });
            if (!answer || answer.id !== run.inputReceiptId || answer.scopeId !== storedTask.scopeId || answer.taskId !== task.taskId
              || answer.actorKind !== access.actorKind || answer.actorId !== access.actorId || answer.audience !== access.audience
              || !request || request.id !== answer.requestId || request.scopeId !== storedTask.scopeId || request.taskId !== task.taskId
              || request.status !== 'CONSUMED' || request.revision < 2 || request.createdBy !== access.actorId
              || request.planHash !== answer.planHash || !answer.consumedAt || answer.consumedAt > request.expiresAt
              || answer.consumedTaskRevision !== request.waitingTaskRevision + 1 || !parent || parent.id !== request.runId
              || parent.scopeId !== storedTask.scopeId || parent.taskId !== task.taskId || parent.sequence + 1 !== run.sequence
              || parent.actorKind !== access.actorKind || parent.actorId !== access.actorId || parent.status !== 'SUCCEEDED'
              || (parent.sequence === 1 ? parent.id !== task.runId || parent.inputReceiptId != null || parent.resourceOriginRunId != null
                : parent.resourceOriginRunId !== task.runId || !parent.inputReceiptId)) throw denied();
            cursor = parent.id;
          }
          const root = await tx.aiRun.findFirst({ where: { scopeId: storedTask.scopeId, taskId: task.taskId, id: task.runId } });
          if (!root || root.sequence !== 1 || root.inputReceiptId != null || root.resourceOriginRunId != null
            || root.actorKind !== access.actorKind || root.actorId !== access.actorId) throw denied();
        }
        const successor = await tx.aiRun.findFirst({ where: { scopeId: storedTask.scopeId, taskId: task.taskId, id: runId } });
        if (!successor || successor.actorKind !== access.actorKind || successor.actorId !== access.actorId) throw denied();
        if (active && (successor.status !== 'RUNNING' || await tx.aiRun.findFirst({ where: {
          scopeId: storedTask.scopeId, taskId: task.taskId, sequence: { gt: successor.sequence } } }))) throw denied();
      };
      // Selection/provenance locks share one transaction. A nested pool
      // transaction cannot validate the caller's uncommitted lineage snapshot.
      if (tx) await lineage(tx); else await this.d.db.$transaction(lineage);
    }
    return { context: current, original: original.receipt, task: { ...task, runId: runId ?? task.runId },
      owner: { scopeId: storedTask.scopeId, audience: access.audience, ownerKind: access.actorKind, ownerId: access.actorId } };
  }
  private quoteHash(quote: RentalQuoteSnapshotV1) {
    const { consumedAt: _at, consumedOrderId: _id, ...immutable } = quote;
    if (Buffer.byteLength(JSON.stringify(immutable), 'utf8') > 262144) throw unavailable();
    return requestFingerprint(immutable);
  }
  private async authorized(command: AiQuoteSelectionCreateDraft, active: boolean, tx?: Prisma.TransactionClient) {
    const before = await this.original(command.originalInputRef, command.taskId, command.runId, active, tx);
    const normalized = JSON.parse(JSON.stringify(this.d.confirmation.normalizeOrderInput(structuredClone(command.order)))) as CreateRentalOrderRequest;
    const inputHash = requestFingerprint(normalized);
    const observe = async (context: AiExecutionContext) => {
      if (context.scope.kind !== 'workspace' || this.d.core.resolveWorkspaceId(context.scope.tenantId) !== context.scope.workspaceId) throw denied();
      const quote = await this.d.quoteFacts.findQuote(context.scope.tenantId, normalized.quoteId, tx);
      if (!quote || quote.id !== normalized.quoteId || quote.tenantId !== context.scope.tenantId) throw unavailable();
      this.d.confirmation.assertOrderMatchesQuote(normalized, quote);
      const quoteHash = this.quoteHash(quote), expiry = Date.parse(quote.expiresAt);
      if (!Number.isFinite(expiry) || (active && (expiry <= this.clock().getTime() || quote.consumedAt || quote.consumedOrderId))) throw unavailable();
      const again = await this.d.quoteFacts.findQuote(context.scope.tenantId, normalized.quoteId, tx);
      if (!again || this.quoteHash(again) !== quoteHash || (active && (again.consumedAt || again.consumedOrderId))) throw conflict();
      const current = await this.original(command.originalInputRef, command.taskId, command.runId, active, tx);
      if (requestFingerprint(current.owner) !== requestFingerprint(before.owner) || originalIdentityHash(current.context) !== originalIdentityHash(context)
        || current.original.contentHash !== before.original.contentHash || current.task.revision !== before.task.revision) throw denied();
      const quoteBasis: Prisma.InputJsonObject = { quoteId: quote.id, ruleVersion: quote.ruleVersion, pricingPlanVersion: quote.pricingPlanVersion,
        ...(quote.priceVersion ? { priceVersion: quote.priceVersion } : {}), createdAt: quote.createdAt, expiresAt: quote.expiresAt };
      return { ...current, body: freezeOriginalInput(normalized), inputHash, quoteHash, quoteBasis,
        expiresAt: new Date(Math.min(expiry, Date.parse(current.original.expiresAt))) };
    };
    // Historical selection/operation receipts need the original GET quote
    // Guard, not today's order-create capability. Current scope/owner, DTO,
    // original quote hash and closing reads still apply; this grants no write.
    return active ? this.route.withOrderPreparation(before.context, normalized, observe)
      : this.route.withOrderReview(before.context, normalized, observe);
  }
  private fingerprint(row: Pick<Row, 'scopeId' | 'audience' | 'ownerKind' | 'ownerId' | 'taskId' | 'runId' | 'originalRequestId' | 'originalInputHash' | 'selectionKey' | 'revision' | 'quoteId' | 'quoteHash' | 'inputHash'> & { quoteBasis: unknown }) {
    return requestFingerprint({ version: AI_QUOTE_SELECTION_DRAFT_VERSION, scopeId: row.scopeId, audience: row.audience, ownerKind: row.ownerKind,
      ownerId: row.ownerId, taskId: row.taskId, runId: row.runId, originalRequestId: row.originalRequestId, originalInputHash: row.originalInputHash,
      selectionKey: row.selectionKey, revision: row.revision, quoteId: row.quoteId, quoteHash: row.quoteHash, inputHash: row.inputHash, quoteBasis: row.quoteBasis });
  }
  private receipt(row: Row): AiQuoteSelectionReceiptDraft {
    return freezeOriginalInput({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, selectionId: row.id, selectionKey: row.selectionKey, revision: row.revision,
      originalInputRef: row.originalRequestId, taskId: row.taskId, runId: row.runId, quoteId: row.quoteId, quoteHash: row.quoteHash, inputHash: row.inputHash,
      expiresAt: row.expiresAt.toISOString(), state: row.supersededAt ? 'superseded' : row.expiresAt.getTime() <= this.clock().getTime() ? 'expired' : 'selected_not_approved',
      approval: 'not_granted', order: 'not_created_by_selection' });
  }
  private rowCommand(row: Row) {
    return parseQuoteSelection({ draftVersion: row.contractVersion, originalInputRef: row.originalRequestId, taskId: row.taskId, runId: row.runId,
      selectionKey: row.selectionKey, expectedSelectionRevision: row.revision - 1, order: row.payload });
  }
  private async verify(row: Row, active: boolean, tx?: Prisma.TransactionClient) {
    if (row.contractVersion !== AI_QUOTE_SELECTION_DRAFT_VERSION || row.selectionFingerprint !== this.fingerprint(row)
      || row.inputHash !== requestFingerprint(row.payload)) throw conflict();
    const current = await this.authorized(this.rowCommand(row), active, tx);
    if (Object.entries(current.owner).some(([key, value]) => row[key as keyof Row] !== value) || row.originalInputHash !== current.original.contentHash) throw denied();
    if (row.quoteHash !== current.quoteHash || row.inputHash !== current.inputHash || requestFingerprint(row.quoteBasis) !== requestFingerprint(current.quoteBasis)) throw conflict();
    if (active && (row.supersededAt !== null || row.expiresAt.getTime() <= this.clock().getTime()
      || row.authorizationBindingHash !== originalIdentityHash(current.context))) throw denied();
    return current;
  }
  async select(value: unknown): Promise<AiQuoteSelectionSelectResponseDraft> {
    const command = parseQuoteSelection(value), initial = await this.authorized(command, true);
    if (!['queued', 'running', 'waiting_input'].includes(initial.task.status)) throw denied();
    const data = { ...initial.owner, taskId: command.taskId, runId: command.runId, originalRequestId: command.originalInputRef,
      originalInputHash: initial.original.contentHash, selectionKey: command.selectionKey, revision: command.expectedSelectionRevision + 1,
      quoteId: initial.body.quoteId, quoteHash: initial.quoteHash, quoteBasis: initial.quoteBasis, inputHash: initial.inputHash };
    const fingerprint = this.fingerprint(data), where = { ...initial.owner, selectionKey: command.selectionKey };
    const startedAt = Date.now();
    let callbackReady = false, phase = 'acquiring_task_lock';
    try {
      return await this.d.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE id = ${command.taskId} AND scopeId = ${initial.owner.scopeId} FOR UPDATE`);
        phase = 'reading_selection';
        const prior = await tx.aiTaskQuoteSelection.findFirst({ where });
        if (prior) {
          if (prior.selectionKey !== command.selectionKey || prior.selectionFingerprint !== fingerprint) throw conflict();
          phase = 'verifying_replay';
          await this.verify(prior, false, tx);
          return { receipt: this.receipt(prior), replayed: true };
        }
        phase = 'validating_revision';
        const latest = await tx.aiTaskQuoteSelection.findFirst({ where: { scopeId: initial.owner.scopeId, taskId: command.taskId, runId: command.runId }, orderBy: { revision: 'desc' } });
        if ((latest?.revision ?? 0) !== command.expectedSelectionRevision) throw conflict();
        // Once this run has published an order input or frozen its plan, a new
        // choice requires a new original/run. Never replace material beneath an
        // existing step/approval. Publication takes the same task row lock.
        const runKey = { scopeId: initial.owner.scopeId, taskId: command.taskId, runId: command.runId };
        if (await tx.aiTaskRunPlan.findFirst({ where: runKey })
          || await tx.aiTaskActionInput.findFirst({ where: runKey })) throw conflict();
        phase = 'authorizing_selection';
        const current = await this.authorized(command, true, tx);
        if (current.quoteHash !== initial.quoteHash || current.inputHash !== initial.inputHash || originalIdentityHash(current.context) !== originalIdentityHash(initial.context)
          || current.task.revision !== initial.task.revision || !['queued', 'running', 'waiting_input'].includes(current.task.status)) throw conflict();
        const now = this.clock();
        if (initial.expiresAt <= now) throw denied();
        phase = 'superseding_selection';
        await tx.aiTaskQuoteSelection.updateMany({ where: { scopeId: initial.owner.scopeId, taskId: command.taskId, runId: command.runId, supersededAt: null }, data: { supersededAt: now } });
        phase = 'creating_selection';
        const saved = await tx.aiTaskQuoteSelection.create({ data: { ...data, id: randomUUID(), contractVersion: AI_QUOTE_SELECTION_DRAFT_VERSION,
          payload: JSON.parse(JSON.stringify(initial.body)) as Prisma.InputJsonObject, selectionFingerprint: fingerprint,
          authorizationBindingHash: originalIdentityHash(initial.context), expiresAt: initial.expiresAt, createdAt: now, supersededAt: null } });
        phase = 'verifying_selection';
        await this.verify(saved, true, tx);
        phase = 'building_receipt';
        const result = { receipt: this.receipt(saved), replayed: false };
        callbackReady = true;
        phase = 'callback_ready';
        return result;
      // Original resource/identity authorities remain live inside the lock.
      // Their measured native read path exceeds 5s even without a write; allow
      // a bounded preparation window, not retries or broader execution rights.
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 30000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw selectionDiagnostic(error, error, phase, startedAt);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const reconciled = await this.reconcile(command);
        if (reconciled.state !== 'observed') throw conflict();
        return { receipt: reconciled.receipt, replayed: true };
      }
      if (callbackReady) throw selectionDiagnostic(new AiOriginalRequestResultUnknownError(), error, phase, startedAt);
      throw selectionDiagnostic(new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'), error, phase, startedAt);
    }
  }
  async reconcile(value: unknown): Promise<AiQuoteSelectionReconcileResponseDraft> {
    const command = parseQuoteSelection(value), current = await this.authorized(command, false);
    let row;
    try { row = await this.d.db.aiTaskQuoteSelection.findFirst({ where: { ...current.owner, selectionKey: command.selectionKey } }); }
    catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
    if (!row) return { state: 'not_observed' as const, retryable: false as const };
    const expected = this.fingerprint({ ...current.owner, taskId: command.taskId, runId: command.runId, originalRequestId: command.originalInputRef,
      originalInputHash: current.original.contentHash, selectionKey: command.selectionKey, revision: command.expectedSelectionRevision + 1,
      quoteId: current.body.quoteId, quoteHash: current.quoteHash, quoteBasis: current.quoteBasis, inputHash: current.inputHash });
    if (row.selectionKey !== command.selectionKey || row.selectionFingerprint !== expected) throw conflict();
    await this.verify(row, false);
    return { state: 'observed' as const, receipt: this.receipt(row), retryable: false as const };
  }
  /** Read the exact scoped original operation without retaining its customer
   * payload in a browser. Missing rows cannot authorize another selection. */
  async readOperationLocator(value: unknown): Promise<AiQuoteSelectionReconcileResponseDraft> {
    const ref = validateQuoteSelectionHttpRequest('AiQuoteSelectionOperationLocatorDraft', value) as AiQuoteSelectionOperationLocatorDraft;
    const initial = await this.original(ref.originalInputRef, ref.taskId, ref.runId);
    let row: Row | null;
    try { row = await this.d.db.aiTaskQuoteSelection.findFirst({ where: { ...initial.owner, taskId: ref.taskId, runId: ref.runId,
      originalRequestId: ref.originalInputRef, selectionKey: ref.selectionKey } }); }
    catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
    if (!row) {
      const closing = await this.original(ref.originalInputRef, ref.taskId, ref.runId);
      if (originalIdentityHash(initial.context) !== originalIdentityHash(closing.context)
        || initial.original.contentHash !== closing.original.contentHash) throw denied();
      return { state: 'not_observed', retryable: false };
    }
    if (row.taskId !== ref.taskId || row.runId !== ref.runId || row.originalRequestId !== ref.originalInputRef
      || row.selectionKey !== ref.selectionKey || row.quoteId !== ref.quoteId || row.revision !== ref.expectedSelectionRevision + 1) throw conflict();
    // Existing load/verify checks current owner/quote-read authority, retained
    // lineage, payload/input hash and the complete original quote fingerprint.
    const loaded = await this.load({ draftVersion: ref.draftVersion, originalInputRef: ref.originalInputRef, selectionId: row.id }, false);
    if (loaded.row.id !== row.id || loaded.row.selectionFingerprint !== row.selectionFingerprint
      || loaded.row.inputHash !== row.inputHash || originalIdentityHash(initial.context) !== originalIdentityHash(loaded.current.context)) throw conflict();
    return { state: 'observed', receipt: this.receipt(loaded.row), retryable: false };
  }
  private async load(value: unknown, active: boolean, tx?: Prisma.TransactionClient) {
    const ref = parseQuoteSelectionRead(value), original = await this.original(ref.originalInputRef, undefined, undefined, false, tx);
    const db: Pick<PrismaClient, 'aiTaskQuoteSelection'> = tx ?? this.d.db;
    if (tx) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE id = ${original.task.taskId} AND scopeId = ${original.owner.scopeId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_task_quote_selections WHERE id = ${ref.selectionId} AND scopeId = ${original.owner.scopeId} FOR UPDATE`);
    }
    let row;
    try { row = await db.aiTaskQuoteSelection.findFirst({ where: { ...original.owner, id: ref.selectionId, originalRequestId: ref.originalInputRef } }); }
    catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
    if (!row || row.id !== ref.selectionId || row.originalRequestId !== ref.originalInputRef) throw unavailable();
    const current = await this.verify(row, active, tx);
    return { row, current };
  }
  async read(value: unknown) { return this.receipt((await this.load(value, false)).row); }
  async readAuthorized(value: unknown, tx?: Prisma.TransactionClient) {
    const ref = parseQuoteSelectionProof(value), { row, current } = await this.load({ draftVersion: ref.draftVersion,
      originalInputRef: ref.originalInputRef, selectionId: ref.selectionId }, true, tx);
    if (row.taskId !== ref.taskId || row.runId !== ref.runId || row.inputHash !== ref.inputHash) throw denied();
    return freezeOriginalInput({ context: current.context, scopeId: row.scopeId, taskId: row.taskId, runId: row.runId,
      originalInputRef: row.originalRequestId, originalInputHash: row.originalInputHash, selectionId: row.id, selectionRevision: row.revision,
      quoteId: row.quoteId, quoteHash: row.quoteHash, inputHash: row.inputHash, body: current.body,
      expiresAt: row.expiresAt.toISOString(), bindingHash: requestFingerprint({ selection: row.selectionFingerprint, identity: row.authorizationBindingHash }) });
  }
}
