import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AI_SCENE_REQUEST_DRAFT_VERSION, type AiSceneRequestReceiptDraft, type AiSceneRequestBody } from '../../../../../../packages/shared/src/ai-scene-request-draft';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskCreationRepository, type AiTaskCreationAuthority } from '../ai-task-creation.repository';
import { originalIdentityHash, type AiOriginalRequestAuthority, type AiOriginalRequestAccess } from './original-request.authority';
import { freezeOriginalInput, originalBody, originalRequestReferenceSchema, parseOriginalRequest } from './original-request.validation';

type Row = Prisma.AiTaskOriginalRequestGetPayload<{}>;
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const keyForTask = (inputRef: string) => `scene-request:${inputRef}`;
export class AiOriginalRequestResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'reconcile';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

export class PrismaOriginalRequestRepository implements AiTaskCreationAuthority {
  private readonly tasks: AiTaskCreationRepository;
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTask' | 'aiTaskOriginalRequest'>,
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
    if (row.contractVersion !== AI_SCENE_REQUEST_DRAFT_VERSION || !Number.isSafeInteger(row.revision) || row.revision < 1
      || row.contentHash !== this.hash(row)) throw unavailable();
    this.body(row);
  }
  private receipt(row: Row): AiSceneRequestReceiptDraft {
    return freezeOriginalInput({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: row.id, revision: row.revision,
      contentHash: row.contentHash, sceneCode: this.body(row).sceneCode, sceneVersion: row.sceneVersion, requestKey: row.requestKey,
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
  async save(value: unknown, isReissue = false) {
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
        if (existing) return { ...(await verify(existing)).receipt, replayed: true };
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
        completed = true;
        return { ...checked.receipt, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      return freezeOriginalInput(result);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
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
  async readTaskReceipt(inputRef: string) {
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
    return { state: 'observed' as const, taskId: row.id, runId: row.runs[0].id, status: row.status.toLowerCase(), revision: row.revision,
      plan: row.runs[0].executionPlan ? 'stored' as const : 'not_observed' as const, resultAvailable: row.resultRef !== null,
      execution: 'not_inferred_from_metadata' as const };
  }
}
