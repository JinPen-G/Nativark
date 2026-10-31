import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AI_SCENE_REQUEST_DRAFT_VERSION, AI_SCENE_CODES, type AiSceneCode, type AiSceneTaskReceiptDraft, type AiSceneRequestReceiptDraft, type AiSceneRequestBody } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskCreationRepository, type AiTaskCreationAuthority } from '../ai-task-creation.repository';
import { originalIdentityHash, type AiOriginalRequestAuthority, type AiOriginalRequestAccess } from './original-request.authority';
import { freezeOriginalInput, originalBody, originalRequestReferenceSchema, parseOriginalRequest } from './original-request.validation';
import { AI_RETENTION_POLICY } from '../privacy/retention-policy';

type Row = Prisma.AiTaskOriginalRequestGetPayload<{}>;
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const keyForTask = (inputRef: string) => `scene-request:${inputRef}`;

/** Immutable original provenance for current-authorized historical model reads.
 * Expiry is not a new-effect grant. Callers must independently authorize the
 * task/resource now and recheck this binding after dependent reads. */
export async function readOriginalTaskModelProvenance(db: Pick<PrismaClient, 'aiTaskOriginalRequest'>,
  task: Prisma.AiTaskGetPayload<{}>) {
  if (!task.inputRef || task.ownerKind !== 'USER' || task.scopeKind !== 'WORKSPACE') throw denied();
  const where = { id: task.inputRef, scopeId: task.scopeId, audience: task.audience,
    ownerKind: task.ownerKind, ownerId: task.ownerId };
  const row = await db.aiTaskOriginalRequest.findFirst({ where });
  if (!row || Object.entries(where).some(([key, value]) => row[key as keyof typeof row] !== value)
    || row.status !== 'STORED' || row.erasedAt || row.sceneCode !== task.sceneCode || row.sceneVersion !== task.sceneVersion
    || row.revision !== task.inputRevision || row.contentHash !== task.inputHash
    || !/^[a-f0-9]{64}$/u.test(row.authorizationBindingHash)) throw denied();
  const body = originalBody(parseOriginalRequest({ draftVersion: row.contractVersion, requestKey: row.requestKey,
    sceneCode: row.sceneCode, input: structuredClone(row.payload) }));
  const contentHash = requestFingerprint({ version: row.contractVersion, scopeId: row.scopeId, audience: row.audience,
    ownerKind: row.ownerKind, ownerId: row.ownerId, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
    revision: row.revision, previousInputRef: row.previousRequestId, input: body.input });
  if (row.contentHash !== contentHash) throw denied();
  return Object.freeze({ inputRef: row.id, contentHash, revision: row.revision,
    authorizationHash: row.authorizationBindingHash,
    bindingHash: requestFingerprint({ ...where, contentHash, revision: row.revision,
      authorizationHash: row.authorizationBindingHash, expiresAt: row.expiresAt.toISOString() }) });
}

export class AiOriginalRequestResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'reconcile';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

export class PrismaOriginalRequestRepository implements AiTaskCreationAuthority {
  private readonly tasks: AiTaskCreationRepository;
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTask' | 'aiTaskOriginalRequest'>
    & Partial<Pick<PrismaClient, 'aiDataErasure'>>,
    private readonly authority: AiOriginalRequestAuthority, private readonly clock: () => Date = () => new Date()) {
    this.tasks = new AiTaskCreationRepository(db, this, clock);
  }
  private async stored<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
  }
  private owned(access: AiOriginalRequestAccess) {
    const identity = aiTaskAccessFromContext(access.context, 'original-request', this.clock());
    if (identity.actorKind !== 'USER' || identity.scope.kind !== 'WORKSPACE') throw denied();
    return { scopeId: access.scopeId, audience: identity.audience, ownerKind: identity.actorKind, ownerId: identity.actorId };
  }
  private sameIdentity(before: AiOriginalRequestAccess, after: AiOriginalRequestAccess) {
    if (before.scopeId !== after.scopeId || originalIdentityHash(before.context) !== originalIdentityHash(after.context)) throw denied();
  }
  private body(row: Row): AiSceneRequestBody {
    try { return originalBody(parseOriginalRequest({ draftVersion: row.contractVersion, requestKey: row.requestKey, sceneCode: row.sceneCode, input: row.payload })); }
    catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
  }
  private hash(row: Pick<Row, 'scopeId' | 'audience' | 'ownerKind' | 'ownerId' | 'sceneCode' | 'sceneVersion' | 'revision' | 'previousRequestId'> & { payload: unknown }) {
    return requestFingerprint({ version: AI_SCENE_REQUEST_DRAFT_VERSION, scopeId: row.scopeId, audience: row.audience,
      ownerKind: row.ownerKind, ownerId: row.ownerId, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
      revision: row.revision, previousInputRef: row.previousRequestId, input: row.payload });
  }
  private exact(row: Row, access: AiOriginalRequestAccess) {
    if (Object.entries(this.owned(access)).some(([key, value]) => row[key as keyof Row] !== value)) throw denied();
    if (row.erasedAt) throw unavailable();
    if (row.contractVersion !== AI_SCENE_REQUEST_DRAFT_VERSION || !Number.isSafeInteger(row.revision) || row.revision < 1
      || row.contentHash !== this.hash(row)) throw unavailable();
    this.body(row);
  }
  private receipt(row: Row): AiSceneRequestReceiptDraft {
    return freezeOriginalInput({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: row.id, revision: row.revision,
      contentHash: row.contentHash, sceneCode: row.sceneCode as AiSceneCode, sceneVersion: row.sceneVersion, requestKey: row.requestKey,
      previousInputRef: row.previousRequestId, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(),
      state: row.status === 'REVOKED' ? 'revoked' : row.expiresAt.getTime() <= this.clock().getTime() ? 'expired' : 'stored' });
  }
  private async checked(row: Row, initial: AiOriginalRequestAccess, creation: boolean, history = false) {
    this.exact(row, initial);
    const body = this.body(row);
    let current: AiOriginalRequestAccess;
    if (creation) {
      const grant = await this.authority.create(body);
      if (row.policyHash !== grant.policyHash || row.policyRevision !== grant.policyRevision || row.sceneVersion !== grant.sceneVersion) throw conflict();
      current = grant;
    } else current = await this.authority.read(body, row.sceneVersion);
    this.sameIdentity(initial, current);
    if (creation && (row.creationClosedAt || row.creationCloseKey)) throw denied();
    if (!history && (row.status !== 'STORED' || row.expiresAt.getTime() <= this.clock().getTime()
      || row.authorizationBindingHash !== originalIdentityHash(current.context))) throw denied();
    return { row, body, context: current.context, receipt: this.receipt(row) };
  }
  private async load(inputRef: string, creation = false, history = false) {
    if (!originalRequestReferenceSchema.safeParse({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef }).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const current = await this.authority.current();
    const row = await this.stored(() => this.db.aiTaskOriginalRequest.findFirst({ where: { ...this.owned(current), id: inputRef } }));
    if (!row || row.id !== inputRef) throw unavailable();
    return this.checked(row, current, creation, history);
  }
  async read(value: unknown) {
    const parsed = originalRequestReferenceSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const result = await this.load(parsed.data.inputRef);
    return freezeOriginalInput({ receipt: result.receipt, request: result.body });
  }
  async readHistorical(value: unknown) {
    const parsed = originalRequestReferenceSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const result = await this.load(parsed.data.inputRef, false, true);
    return freezeOriginalInput({ receipt: result.receipt, request: result.body, context: result.context });
  }
  /** Retained business locator only. An erasure receipt attests deletion, not
   * the missing plaintext. Current task policy and downstream Core/quote guards
   * still authorize each read; this never returns scene input or a create grant. */
  async readTaskLocator(value: unknown) {
    const parsed = originalRequestReferenceSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const inputRef = parsed.data.inputRef, initial = await this.authority.current();
    const row = await this.stored(() => this.db.aiTaskOriginalRequest.findFirst({ where: { ...this.owned(initial), id: inputRef } }));
    if (!row || row.id !== inputRef) throw unavailable();
    if (!row.erasedAt) {
      const original = await this.checked(row, initial, false, true);
      return freezeOriginalInput({ receipt: original.receipt, context: original.context, material: 'retained' as const,
        task: await this.readTaskReceipt(inputRef) });
    }
    if (!this.authority.observeTask || !this.db.aiDataErasure || row.contractVersion !== AI_SCENE_REQUEST_DRAFT_VERSION
      || !(AI_SCENE_CODES as readonly string[]).includes(row.sceneCode) || !Number.isSafeInteger(row.revision) || row.revision < 1
      || !/^[a-f0-9]{64}$/u.test(row.contentHash) || !/^[a-f0-9]{64}$/u.test(row.authorizationBindingHash)) throw unavailable();
    const read = async () => {
      const task = await this.db.aiTask.findFirst({ where: { ...this.owned(initial), creationKey: keyForTask(inputRef) }, select: {
        id: true, scopeId: true, scopeKind: true, ownerKind: true, ownerId: true, audience: true, creationKey: true,
        inputRef: true, inputRevision: true, inputHash: true, sceneCode: true, sceneVersion: true,
        archivedAt: true, status: true, revision: true, resultRef: true, createdAt: true,
        runs: { where: { sequence: 1 }, take: 2, select: { id: true, scopeId: true, taskId: true, sequence: true,
          actorKind: true, actorId: true, inputReceiptId: true, resourceOriginRunId: true, executionPlan: { select: { planHash: true } } } } } });
      if (!task || task.creationKey !== keyForTask(inputRef) || task.inputRef !== row.id || task.inputRevision !== row.revision || task.inputHash !== row.contentHash
        || !['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)
        || task.sceneCode !== row.sceneCode || task.sceneVersion !== row.sceneVersion || task.archivedAt !== null
        || task.scopeKind !== 'WORKSPACE' || Object.entries(this.owned(initial)).some(([key, value]) => task[key as keyof typeof task] !== value)
        || task.runs.length !== 1 || task.runs[0].sequence !== 1 || task.runs[0].scopeId !== row.scopeId || task.runs[0].taskId !== task.id
        || task.runs[0].actorKind !== task.ownerKind || task.runs[0].actorId !== task.ownerId
        || task.runs[0].inputReceiptId != null || task.runs[0].resourceOriginRunId != null) throw unavailable();
      const marker = row.payload;
      if (!marker || typeof marker !== 'object' || Array.isArray(marker) || marker.retention !== 'erased'
        || marker.policyVersion !== AI_RETENTION_POLICY.version || typeof marker.receiptId !== 'string') throw unavailable();
      const erasure = await this.db.aiDataErasure!.findUnique({ where: { id: marker.receiptId } });
      const scope = initial.context.scope;
      if (scope.kind !== 'workspace' || !erasure || erasure.state !== 'erased' || erasure.tenantId !== scope.tenantId
        || erasure.workspaceId !== scope.workspaceId || erasure.policyVersion !== AI_RETENTION_POLICY.version
        || !(erasure.erasedAt instanceof Date) || erasure.erasedAt > this.clock()
        || !['task', 'request'].includes(erasure.kind)
        || erasure.resourceId !== (erasure.kind === 'task' ? task.id : row.id)
        || erasure.id !== requestFingerprint([AI_RETENTION_POLICY.version, scope.tenantId, scope.workspaceId, erasure.kind, erasure.resourceId])
        || erasure.targetHash !== (erasure.kind === 'task'
          ? requestFingerprint(['task', task.id, task.inputRef, task.inputHash, task.createdAt.toISOString()])
          : requestFingerprint(['request', row.id, row.contentHash, row.createdAt.toISOString()]))) throw denied();
      return { taskId: task.id, runId: task.runs[0].id, revision: task.revision, status: task.status.toLowerCase() as Lowercase<typeof task.status>,
        plan: task.runs[0].executionPlan ? 'stored' as const : 'not_observed' as const, resultAvailable: task.resultRef !== null };
    };
    const rowBinding = (value: Row) => requestFingerprint({ ...value, createdAt: value.createdAt.toISOString(),
      expiresAt: value.expiresAt.toISOString(), erasedAt: value.erasedAt?.toISOString() });
    const before = await read(), current = await this.authority.observeTask(before.taskId);
    this.sameIdentity(initial, current);
    const after = await read(), latest = await this.db.aiTaskOriginalRequest.findFirst({ where: { ...this.owned(current), id: inputRef } });
    if (!latest || requestFingerprint(before) !== requestFingerprint(after)
      || rowBinding(latest) !== rowBinding(row)) throw denied();
    this.sameIdentity(current, await this.authority.observeTask(before.taskId));
    return freezeOriginalInput({ receipt: this.receipt(row), context: current.context, material: 'erased' as const,
      task: { state: 'observed' as const, ...before, execution: 'not_inferred_from_metadata' as const } });
  }
  /** A trusted association participant may atomically attach metadata to the
   * original request. It cannot create a task or dispatch inside this transaction.
   * Association conflicts roll back the request as well; normal callers omit it. */
  async save(value: unknown, isReissue = false,
    associate?: (tx: Prisma.TransactionClient, receipt: AiSceneRequestReceiptDraft) => Promise<void>) {
    const command = parseOriginalRequest(value, isReissue), body = originalBody(command);
    const previousRef = command.previousInputRef ?? null;
    const initial = await this.authority.create(body);
    const owner = this.owned(initial);
    const previous = previousRef ? await this.load(previousRef, false, true) : null;
    if (previous) {
      this.sameIdentity(initial, { scopeId: previous.row.scopeId, context: previous.context });
      if (previous.row.requestKey === command.requestKey || previous.row.sceneCode !== body.sceneCode || previous.row.revision >= 4294967294) throw conflict();
    }
    const identity = { ...owner, sceneCode: body.sceneCode, sceneVersion: initial.sceneVersion,
      revision: previous ? previous.row.revision + 1 : 1, previousRequestId: previousRef, payload: body.input };
    const contentHash = this.hash(identity), where = { ...owner, requestKey: command.requestKey };
    const verify = async (row: Row) => {
      if (row.requestKey !== command.requestKey || row.contentHash !== contentHash) throw conflict();
      return this.checked(row, initial, true);
    };
    let completed = false;
    try {
      const result = await this.db.$transaction(async tx => {
        const existing = await tx.aiTaskOriginalRequest.findFirst({ where });
        if (existing) {
          const receipt = (await verify(existing)).receipt;
          await associate?.(tx, receipt);
          completed = Boolean(associate);
          return { ...receipt, replayed: true };
        }
        const current = await this.authority.create(body);
        this.sameIdentity(initial, current);
        if (initial.policyHash !== current.policyHash || initial.policyRevision !== current.policyRevision) throw conflict();
        const now = this.clock(), expiresAt = new Date(initial.expiresAt);
        if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) throw denied();
        const row = await tx.aiTaskOriginalRequest.create({ data: { ...identity, id: randomUUID(), requestKey: command.requestKey,
          contractVersion: AI_SCENE_REQUEST_DRAFT_VERSION, payload: identity.payload as Prisma.InputJsonObject,
          contentHash, authorizationBindingHash: originalIdentityHash(initial.context), policyRevision: initial.policyRevision,
          policyHash: initial.policyHash, expiresAt, createdAt: now, status: 'STORED' } });
        const checked = await verify(row);
        await associate?.(tx, checked.receipt);
        completed = true;
        return { ...checked.receipt, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      return freezeOriginalInput(result);
    } catch (error) {
      // Once the participant completed, a lost COMMIT reply is an unknown
      // association even when a transport maps it to a typed repository error.
      if (associate && completed) throw new AiOriginalRequestResultUnknownError();
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A uniqueness race does not prove the separate association committed.
        // Its caller must observe the original operation, not replay a callback.
        if (associate) throw new AiOriginalRequestResultUnknownError();
        const row = await this.stored(() => this.db.aiTaskOriginalRequest.findFirst({ where }));
        if (!row) throw conflict();
        return freezeOriginalInput({ ...(await verify(row)).receipt, replayed: true });
      }
      if (completed) throw new AiOriginalRequestResultUnknownError();
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }
  async reconcile(value: unknown, isReissue = false) {
    const command = parseOriginalRequest(value, isReissue), current = await this.authority.current();
    const row = await this.stored(() => this.db.aiTaskOriginalRequest.findFirst({ where: { ...this.owned(current), requestKey: command.requestKey } }));
    if (!row) { this.sameIdentity(current, await this.authority.current()); return { state: 'not_observed' as const, retryable: false as const }; }
    const previousRef = command.previousInputRef ?? null;
    if (row.requestKey !== command.requestKey || row.previousRequestId !== previousRef
      || requestFingerprint(this.body(row)) !== requestFingerprint(originalBody(command))) throw conflict();
    const result = await this.checked(row, current, false, true);
    return { state: 'observed' as const, receipt: result.receipt, task: await this.readTaskReceipt(row.id) };
  }
  /** Owner-authorized retained material or the original erasure receipt. With no
   * Task, a receipt attests erased input only; it cannot invent task execution. */
  private async closureMaterial(row: Row, access: AiOriginalRequestAccess) {
    if (!row.erasedAt) { this.exact(row, access); return { material: 'retained' as const, request: this.body(row) }; }
    const scope = access.context.scope, marker = row.payload;
    if (scope.kind !== 'workspace' || Object.entries(this.owned(access)).some(([key, value]) => row[key as keyof Row] !== value)
      || row.contractVersion !== AI_SCENE_REQUEST_DRAFT_VERSION || !(AI_SCENE_CODES as readonly string[]).includes(row.sceneCode)
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || !/^[a-f0-9]{64}$/u.test(row.contentHash)
      || !/^[a-f0-9]{64}$/u.test(row.authorizationBindingHash) || !this.db.aiDataErasure
      || !marker || typeof marker !== 'object' || Array.isArray(marker) || marker.retention !== 'erased'
      || marker.policyVersion !== AI_RETENTION_POLICY.version || typeof marker.receiptId !== 'string') throw unavailable();
    const erasure = await this.db.aiDataErasure.findUnique({ where: { id: marker.receiptId } });
    if (!erasure || erasure.id !== requestFingerprint([AI_RETENTION_POLICY.version, scope.tenantId, scope.workspaceId, 'request', row.id])
      || erasure.tenantId !== scope.tenantId || erasure.workspaceId !== scope.workspaceId || erasure.kind !== 'request'
      || erasure.resourceId !== row.id || erasure.state !== 'erased' || erasure.policyVersion !== AI_RETENTION_POLICY.version
      || !(erasure.erasedAt instanceof Date) || erasure.erasedAt.getTime() !== row.erasedAt.getTime() || erasure.erasedAt > this.clock()
      || erasure.targetHash !== requestFingerprint(['request', row.id, row.contentHash, row.createdAt.toISOString()])) throw unavailable();
    return { material: 'erased' as const, request: null };
  }
  private closureBinding(row: Row) {
    return requestFingerprint({ ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      erasedAt: row.erasedAt?.toISOString(), creationClosedAt: row.creationClosedAt?.toISOString() });
  }
  /** Caller owns its scope/conversation locks. The original row is shared with
   * Task creation, so absence is useful only after this permanent fence commits. */
  async closeUnstartedCreation(tx: Prisma.TransactionClient, inputRef: string, operationKey: string, beforeWrite: () => void) {
    const initial = await this.authority.current(), owner = this.owned(initial);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_task_original_requests WHERE scopeId = ${owner.scopeId} AND id = ${inputRef} FOR UPDATE`);
    const row = await tx.aiTaskOriginalRequest.findFirst({ where: { ...owner, id: inputRef } });
    if (!row) throw unavailable();
    await this.closureMaterial(row, initial);
    if (row.status !== 'STORED' || row.creationClosedAt || row.creationCloseKey) throw conflict();
    // Any matching task, including an archived one or a malformed owner link,
    // prevents this unstarted close. No financial/step evidence is erased.
    if (await tx.aiTask.findFirst({ where: { scopeId: owner.scopeId, OR: [{ inputRef }, { creationKey: keyForTask(inputRef) }] },
      select: { id: true } })) throw unavailable();
    this.sameIdentity(initial, await this.authority.current());
    const closedAt = this.clock();
    if (!(closedAt instanceof Date) || !Number.isFinite(closedAt.getTime())) throw unavailable();
    beforeWrite();
    const changed = await tx.aiTaskOriginalRequest.updateMany({ where: { ...owner, id: inputRef, status: 'STORED',
      creationClosedAt: null, creationCloseKey: null, contentHash: row.contentHash, revision: row.revision, erasedAt: row.erasedAt },
      data: { creationClosedAt: closedAt, creationCloseKey: operationKey } });
    if (changed.count !== 1) throw conflict();
    this.sameIdentity(initial, await this.authority.current());
    return { inputRef: row.id, requestKey: row.requestKey, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
      admissionHash: row.erasedAt ? null : requestFingerprint(this.body(row)), closedAt };
  }
  async assertCreationOpen(tx: Prisma.TransactionClient, command: { creationKey: string; sceneCode: string; inputRef: string },
    grant: { context: import('@rental-os/shared').AiExecutionContext; scopeId: string; sceneVersion: string; inputRevision: number; inputHash: string }) {
    const scope = grant.context.scope;
    if (scope.kind !== 'workspace' || grant.context.actor.kind !== 'user' || command.creationKey !== keyForTask(command.inputRef)) throw denied();
    const owner = this.owned({ context: grant.context, scopeId: grant.scopeId });
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_task_original_requests WHERE scopeId = ${owner.scopeId} AND id = ${command.inputRef} FOR UPDATE`);
    const row = await tx.aiTaskOriginalRequest.findFirst({ where: { ...owner, id: command.inputRef } });
    if (!row || row.sceneCode !== command.sceneCode || row.sceneVersion !== grant.sceneVersion || row.revision !== grant.inputRevision || row.contentHash !== grant.inputHash
      || row.status !== 'STORED' || row.erasedAt || row.creationClosedAt || row.creationCloseKey
      || row.expiresAt <= this.clock()) throw denied();
    this.exact(row, { context: grant.context, scopeId: owner.scopeId });
  }
  async resolve(sceneCode: string, inputRef: string) {
    const result = await this.load(inputRef, true);
    if (result.row.sceneCode !== sceneCode) throw denied();
    return { context: result.context, creationAllowed: true as const, sceneCode, sceneVersion: result.row.sceneVersion,
      inputRef: result.row.id, inputRevision: result.row.revision, inputHash: result.row.contentHash };
  }
  async createTask(value: unknown) {
    const parsed = originalRequestReferenceSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const original = await this.load(parsed.data.inputRef, true);
    return this.tasks.create({ creationKey: keyForTask(original.row.id), sceneCode: original.row.sceneCode, inputRef: original.row.id });
  }
  /** Observe a closed request through current owner identity, not today's
   * execution policy/resources. A fenced request can never regain creation. */
  async readCreationClosure(value: unknown) {
    const parsed = originalRequestReferenceSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const initial = await this.authority.current(), owner = this.owned(initial);
    const row = await this.db.aiTaskOriginalRequest.findFirst({ where: { ...owner, id: parsed.data.inputRef } });
    if (!row || !row.creationClosedAt && !row.creationCloseKey) return null;
    const material = await this.closureMaterial(row, initial);
    if (row.status !== 'STORED' || !row.creationCloseKey || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(row.creationCloseKey)
      || !(row.creationClosedAt instanceof Date) || !Number.isFinite(row.creationClosedAt.getTime()) || row.creationClosedAt > this.clock()
      || await this.db.aiTask.findFirst({ where: { scopeId: owner.scopeId, OR: [{ inputRef: row.id }, { creationKey: keyForTask(row.id) }] }, select: { id: true } })) throw unavailable();
    this.sameIdentity(initial, await this.authority.current());
    const current = await this.db.aiTaskOriginalRequest.findFirst({ where: { ...owner, id: row.id } });
    if (!current || this.closureBinding(current) !== this.closureBinding(row)
      || requestFingerprint(await this.closureMaterial(current, initial)) !== requestFingerprint(material)) throw conflict();
    this.sameIdentity(initial, await this.authority.current());
    return { receipt: this.receipt(row), ...material, operationKey: row.creationCloseKey, closedAt: row.creationClosedAt };
  }
  async readTaskReceipt(inputRef: string): Promise<AiSceneTaskReceiptDraft> {
    if (!originalRequestReferenceSchema.safeParse({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef }).success)
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const current = await this.authority.current();
    const head = await this.stored(() => this.db.aiTaskOriginalRequest.findFirst({ where: { ...this.owned(current), id: inputRef } }));
    if (head?.erasedAt) return (await this.readTaskLocator({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef })).task;
    const original = await this.load(inputRef, false, true), access = aiTaskAccessFromContext(original.context, 'original-request', this.clock());
    const row = await this.stored(() => this.db.aiTask.findFirst({ where: { scopeId: original.row.scopeId, scope: { is: access.scope },
      audience: access.audience, ownerKind: access.actorKind, ownerId: access.actorId, creationKey: keyForTask(inputRef) },
      select: { id: true, scopeId: true, audience: true, ownerKind: true, ownerId: true, creationKey: true, inputRef: true, inputRevision: true,
        inputHash: true, sceneCode: true, sceneVersion: true, status: true, revision: true, archivedAt: true, resultRef: true,
        runs: { where: { sequence: 1 }, take: 1, select: { id: true, executionPlan: { select: { planHash: true } } } } } }));
    await this.checked(original.row, { context: original.context, scopeId: original.row.scopeId }, false, true);
    if (!row) return { state: 'not_observed' as const, retryable: false as const };
    if (row.creationKey !== keyForTask(inputRef) || row.inputRef !== inputRef || row.inputRevision !== original.row.revision
      || row.inputHash !== original.row.contentHash || row.sceneCode !== original.row.sceneCode || row.sceneVersion !== original.row.sceneVersion
      || Object.entries(this.owned({ context: original.context, scopeId: original.row.scopeId })).some(([key, value]) => row[key as keyof typeof row] !== value)
      || row.archivedAt !== null || row.runs.length !== 1) throw unavailable();
    return { state: 'observed' as const, taskId: row.id, runId: row.runs[0].id, status: row.status.toLowerCase() as Lowercase<typeof row.status>, revision: row.revision,
      plan: row.runs[0].executionPlan ? 'stored' as const : 'not_observed' as const, resultAvailable: row.resultRef !== null,
      execution: 'not_inferred_from_metadata' as const };
  }
}
