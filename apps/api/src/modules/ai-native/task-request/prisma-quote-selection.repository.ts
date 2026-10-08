import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { CreateRentalOrderRequest, RentalQuoteSnapshotV1 } from '@rental-os/shared';
import { AI_QUOTE_SELECTION_DRAFT_VERSION, type AiQuoteSelectionCreateDraft, type AiQuoteSelectionReceiptDraft } from '../../../../../../packages/shared/src/ai-quote-selection-draft';
import { AI_SCENE_REQUEST_DRAFT_VERSION } from '../../../../../../packages/shared/src/ai-scene-request-draft';
import type { ControlledApprovedOrderDependencies } from '../approval-execution/controlled-approved-order.composition';
import { AiApprovedOrderRouteAuthority } from '../approval-execution/approved-order-route.authority';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { PrismaOriginalRequestRepository, AiOriginalRequestResultUnknownError } from './prisma-original-request.repository';
import { originalIdentityHash } from './original-request.authority';
import { freezeOriginalInput } from './original-request.validation';
import { parseQuoteSelection, parseQuoteSelectionRead, parseQuoteSelectionProof } from './quote-selection.validation';

type Row = Prisma.AiTaskQuoteSelectionGetPayload<{}>;
export type HumanQuoteSelectionDependencies = Pick<ControlledApprovedOrderDependencies,
  'db' | 'auth' | 'credentials' | 'guard' | 'confirmation' | 'quoteFacts' | 'core' | 'clock'> & { originals: PrismaOriginalRequestRepository };
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');

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
  private async original(inputRef: string, taskId?: string, runId?: string, active = false) {
    const reference = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef };
    const original = await this.d.originals.readHistorical(reference), current = await this.identity.resolve();
    if (original.request.sceneCode !== 'quote_clarification' || current.actor.kind !== 'user' || current.scope.kind !== 'workspace'
      || originalIdentityHash(original.context) !== originalIdentityHash(current)) throw denied();
    const task = await this.d.originals.readTaskReceipt(inputRef);
    if (task.state !== 'observed' || (taskId && task.taskId !== taskId) || (runId && task.runId !== runId)) throw unavailable();
    if (active) {
      await this.d.originals.resolve(original.request.sceneCode, inputRef);
      if (!['queued', 'running', 'waiting_input', 'waiting_confirmation'].includes(task.status)) throw denied();
    }
    const access = aiTaskAccessFromContext(current, task.taskId, this.clock());
    const storedTask = await this.d.db.aiTask.findFirst({ where: { ...access.where, id: task.taskId }, select: { scopeId: true, inputRef: true } });
    if (!storedTask || storedTask.inputRef !== inputRef) throw denied();
    return { context: current, original: original.receipt, task,
      owner: { scopeId: storedTask.scopeId, audience: access.audience, ownerKind: access.actorKind, ownerId: access.actorId } };
  }
  private quoteHash(quote: RentalQuoteSnapshotV1) {
    const { consumedAt: _at, consumedOrderId: _id, ...immutable } = quote;
    if (Buffer.byteLength(JSON.stringify(immutable), 'utf8') > 262144) throw unavailable();
    return requestFingerprint(immutable);
  }
  private async authorized(command: AiQuoteSelectionCreateDraft, active: boolean, tx?: Prisma.TransactionClient) {
    const before = await this.original(command.originalInputRef, command.taskId, command.runId, active);
    const normalized = JSON.parse(JSON.stringify(this.d.confirmation.normalizeOrderInput(structuredClone(command.order)))) as CreateRentalOrderRequest;
    const inputHash = requestFingerprint(normalized);
    return this.route.withOrderPreparation(before.context, normalized, async context => {
      if (context.scope.kind !== 'workspace' || this.d.core.resolveWorkspaceId(context.scope.tenantId) !== context.scope.workspaceId) throw denied();
      const quote = await this.d.quoteFacts.findQuote(context.scope.tenantId, normalized.quoteId, tx);
      if (!quote || quote.id !== normalized.quoteId || quote.tenantId !== context.scope.tenantId) throw unavailable();
      this.d.confirmation.assertOrderMatchesQuote(normalized, quote);
      const quoteHash = this.quoteHash(quote), expiry = Date.parse(quote.expiresAt);
      if (!Number.isFinite(expiry) || (active && (expiry <= this.clock().getTime() || quote.consumedAt || quote.consumedOrderId))) throw unavailable();
      const again = await this.d.quoteFacts.findQuote(context.scope.tenantId, normalized.quoteId, tx);
      if (!again || this.quoteHash(again) !== quoteHash || (active && (again.consumedAt || again.consumedOrderId))) throw conflict();
      const current = await this.original(command.originalInputRef, command.taskId, command.runId, active);
      if (requestFingerprint(current.owner) !== requestFingerprint(before.owner) || originalIdentityHash(current.context) !== originalIdentityHash(context)
        || current.original.contentHash !== before.original.contentHash || current.task.revision !== before.task.revision) throw denied();
      const quoteBasis: Prisma.InputJsonObject = { quoteId: quote.id, ruleVersion: quote.ruleVersion, pricingPlanVersion: quote.pricingPlanVersion,
        ...(quote.priceVersion ? { priceVersion: quote.priceVersion } : {}), createdAt: quote.createdAt, expiresAt: quote.expiresAt };
      return { ...current, body: freezeOriginalInput(normalized), inputHash, quoteHash, quoteBasis,
        expiresAt: new Date(Math.min(expiry, Date.parse(current.original.expiresAt))) };
    });
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
  async select(value: unknown) {
    const command = parseQuoteSelection(value), initial = await this.authorized(command, true);
    if (!['queued', 'running', 'waiting_input'].includes(initial.task.status)) throw denied();
    const data = { ...initial.owner, taskId: command.taskId, runId: command.runId, originalRequestId: command.originalInputRef,
      originalInputHash: initial.original.contentHash, selectionKey: command.selectionKey, revision: command.expectedSelectionRevision + 1,
      quoteId: initial.body.quoteId, quoteHash: initial.quoteHash, quoteBasis: initial.quoteBasis, inputHash: initial.inputHash };
    const fingerprint = this.fingerprint(data), where = { ...initial.owner, selectionKey: command.selectionKey };
    let completed = false;
    try {
      return await this.d.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE id = ${command.taskId} AND scopeId = ${initial.owner.scopeId} FOR UPDATE`);
        const prior = await tx.aiTaskQuoteSelection.findFirst({ where });
        if (prior) {
          if (prior.selectionKey !== command.selectionKey || prior.selectionFingerprint !== fingerprint) throw conflict();
          await this.verify(prior, false, tx);
          return { receipt: this.receipt(prior), replayed: true };
        }
        const latest = await tx.aiTaskQuoteSelection.findFirst({ where: { scopeId: initial.owner.scopeId, taskId: command.taskId, runId: command.runId }, orderBy: { revision: 'desc' } });
        if ((latest?.revision ?? 0) !== command.expectedSelectionRevision) throw conflict();
        // Once this run has published an order input or frozen its plan, a new
        // choice requires a new original/run. Never replace material beneath an
        // existing step/approval. Publication takes the same task row lock.
        const runKey = { scopeId: initial.owner.scopeId, taskId: command.taskId, runId: command.runId };
        if (await tx.aiTaskRunPlan.findFirst({ where: runKey })
          || await tx.aiTaskActionInput.findFirst({ where: { ...runKey, toolCode: 'rental.order.commit' } })) throw conflict();
        const current = await this.authorized(command, true, tx);
        if (current.quoteHash !== initial.quoteHash || current.inputHash !== initial.inputHash || originalIdentityHash(current.context) !== originalIdentityHash(initial.context)
          || current.task.revision !== initial.task.revision || !['queued', 'running', 'waiting_input'].includes(current.task.status)) throw conflict();
        const now = this.clock();
        if (initial.expiresAt <= now) throw denied();
        await tx.aiTaskQuoteSelection.updateMany({ where: { scopeId: initial.owner.scopeId, taskId: command.taskId, runId: command.runId, supersededAt: null }, data: { supersededAt: now } });
        const saved = await tx.aiTaskQuoteSelection.create({ data: { ...data, id: randomUUID(), contractVersion: AI_QUOTE_SELECTION_DRAFT_VERSION,
          payload: JSON.parse(JSON.stringify(initial.body)) as Prisma.InputJsonObject, selectionFingerprint: fingerprint,
          authorizationBindingHash: originalIdentityHash(initial.context), expiresAt: initial.expiresAt, createdAt: now, supersededAt: null } });
        await this.verify(saved, true, tx);
        completed = true;
        return { receipt: this.receipt(saved), replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const reconciled = await this.reconcile(command);
        if (reconciled.state !== 'observed') throw conflict();
        return { receipt: reconciled.receipt, replayed: true };
      }
      if (completed) throw new AiOriginalRequestResultUnknownError();
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }
  async reconcile(value: unknown) {
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
  private async load(value: unknown, active: boolean, tx?: Prisma.TransactionClient) {
    const ref = parseQuoteSelectionRead(value), original = await this.original(ref.originalInputRef);
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
