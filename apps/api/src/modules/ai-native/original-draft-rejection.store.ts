/** Append-only rejection evidence for one original rule/calendar draft operation.
 * A missing success receipt alone proves nothing: record requires the original
 * tenant/workspace lock and a current stale-material witness. Callers own the
 * original Guard and must check read() in every Core write revalidation while
 * Core holds that lock. This store neither writes nor publishes business drafts. */
import { Prisma, type OperationLog, type PrismaClient } from '@prisma/client';
import { aiTaskDraftRejectedOperation, type AiTaskDraftRejectedOperation } from '@rental-os/shared';
import { z } from 'zod';
import { getRequestIdentity } from '../../common/request-identity';
import { lockRentalBusinessTenant } from '../rental-core/rental-business-fence';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from './ai-task.repository';
import { freezeOriginalInput, originalRequestReferenceSchema } from './task-request/original-request.validation';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
// Core formats a digest as a UUID; its version/variant bits are not randomUUID's.
const operationId = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u);
const bindingSchema = z.object({
  kind: z.enum(['business_rule', 'business_calendar']),
  scope: z.object({ tenantId: id, workspaceId: id, actorId: id }).strict(),
  original: originalRequestReferenceSchema, registrationRef: id,
  materialHash: hash, payloadHash: hash, targetId: id, targetVersion: id,
  operationKey: id.max(128), operationId
}).strict();
const action = 'ai.original_draft.rejected';
const proofVersion = 'ai-original-draft-rejection-1';
const savedSchema = z.object({
  version: z.literal(proofVersion), action: z.literal(action), binding: bindingSchema,
  bindingHash: hash, operation: aiTaskDraftRejectedOperation, receiptHash: hash
}).strict();
const uuid = (digest: string) => `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;

export type OriginalDraftRejectionBinding = z.infer<typeof bindingSchema>;
export type OriginalDraftRejectedOperation = AiTaskDraftRejectedOperation;
type Db = Pick<PrismaClient, '$transaction' | 'operationLog' | 'rentalCalendarOverrideAuditEntry'>;
type Reader = Pick<PrismaClient, 'operationLog' | 'rentalCalendarOverrideAuditEntry'>;
type Verify = (tx?: Prisma.TransactionClient) => Promise<void>;

export class OriginalDraftRejectedError extends AiTaskRepositoryError {
  readonly operation: OriginalDraftRejectedOperation;
  constructor(operation: OriginalDraftRejectedOperation) {
    super('AI_REVISION_CONFLICT');
    this.name = 'OriginalDraftRejectedError';
    this.operation = freezeOriginalInput(aiTaskDraftRejectedOperation.parse(structuredClone(operation)));
  }
}

export class OriginalDraftRejectionUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  constructor() { super('AI_RESULT_UNKNOWN'); this.name = 'OriginalDraftRejectionUnknownError'; }
}

export class OriginalDraftRejectionStore {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof db.operationLog?.findUnique !== 'function'
      || typeof db.operationLog?.create !== 'function' || typeof db.rentalCalendarOverrideAuditEntry?.findUnique !== 'function'
      || typeof clock !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }

  private identity(binding: OriginalDraftRejectionBinding) {
    const current = getRequestIdentity(), scope = binding.scope;
    if (!current || current.tenantId !== scope.tenantId || current.workspaceId !== scope.workspaceId
      || current.userId !== scope.actorId || current.isSaasAdmin || current.staffApi || current.audience === 'client')
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }

  private target(value: OriginalDraftRejectionBinding) {
    const parsed = bindingSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const binding = freezeOriginalInput(parsed.data);
    const bindingHash = requestFingerprint({ original: binding.original, registrationRef: binding.registrationRef,
      materialHash: binding.materialHash, payloadHash: binding.payloadHash });
    const rule = binding.kind === 'business_rule';
    const expectedKey = `${rule ? 'rule' : 'calendar'}-draft-${bindingHash}`;
    const expectedId = uuid(requestFingerprint({ kind: rule ? 'rule-bound-draft-1' : 'calendar-bound-draft-1',
      scope: binding.scope, operationKey: expectedKey }));
    if (binding.operationKey !== expectedKey || binding.operationId !== expectedId)
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    this.identity(binding);
    const receiptId = uuid(requestFingerprint({ kind: proofVersion, scope: binding.scope, operationId: binding.operationId }));
    return { binding, bindingHash, receiptId };
  }

  private decode(row: OperationLog, target: ReturnType<OriginalDraftRejectionStore['target']>) {
    const parsed = savedSchema.safeParse(row.detail), { binding, bindingHash, receiptId } = target;
    if (!parsed.success || row.id !== receiptId || row.tenantId !== binding.scope.tenantId
      || row.workspaceId !== binding.scope.workspaceId || row.userId !== binding.scope.actorId
      || row.rentalOrderId !== null || row.action !== action || !(row.createdAt instanceof Date)
      || !Number.isFinite(row.createdAt.getTime())) throw new OriginalDraftRejectionUnknownError();
    const { receiptHash, ...proof } = parsed.data;
    if (receiptHash !== requestFingerprint(proof) || requestFingerprint(proof.binding) !== requestFingerprint(binding)
      || proof.bindingHash !== bindingHash || proof.operation.receiptId !== receiptId
      || proof.operation.recordedAt !== row.createdAt.toISOString()) throw new OriginalDraftRejectionUnknownError();
    return freezeOriginalInput(proof.operation);
  }

  private async hasSuccess(binding: OriginalDraftRejectionBinding, reader: Reader) {
    // The original Core reader owns success-proof validation. Any row at its
    // operation ID blocks a no-commit claim, including a damaged success row.
    const query = { where: { id: binding.operationId }, select: { id: true as const } };
    return Boolean(binding.kind === 'business_rule' ? await reader.operationLog.findUnique(query)
      : await reader.rentalCalendarOverrideAuditEntry.findUnique(query));
  }

  /** Read inside the original Guard/ALS. Null grants neither retry nor no-write
   * certainty. The caller revalidates current read permission before delivery. */
  async read(binding: OriginalDraftRejectionBinding, tx?: Prisma.TransactionClient): Promise<OriginalDraftRejectedOperation | null> {
    const target = this.target(binding), reader = tx ?? this.db;
    try {
      const row = await reader.operationLog.findUnique({ where: { id: target.receiptId } });
      const operation = row ? this.decode(row, target) : null;
      if (operation && await this.hasSuccess(target.binding, reader)) throw new OriginalDraftRejectionUnknownError();
      this.identity(target.binding);
      return operation;
    } catch { throw new OriginalDraftRejectionUnknownError(); }
  }

  /** verify is the original current authority; isStale must only read the
   * original material using this locked transaction, never classify an HTTP
   * error or absence of a receipt as stale. Neither callback grants new scope. */
  async record(binding: OriginalDraftRejectionBinding, reviewHash: string, verify: Verify,
    isStale: (tx: Prisma.TransactionClient) => Promise<boolean>): Promise<OriginalDraftRejectedOperation | null> {
    const target = this.target(binding);
    if (!hash.safeParse(reviewHash).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (typeof verify !== 'function' || typeof isStale !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const check = async (tx?: Prisma.TransactionClient) => {
      this.identity(target.binding); await verify(tx); this.identity(target.binding);
    };
    let attempted = false, observed = false;
    try {
      const result = await this.db.$transaction(async tx => {
        const { scope } = target.binding;
        await lockRentalBusinessTenant(tx, scope.tenantId);
        const rows = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM business_workspaces WHERE tenantId = ${scope.tenantId} AND id = ${scope.workspaceId} FOR UPDATE`);
        if (rows.length !== 1 || rows[0].id !== scope.workspaceId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        await check(tx);
        const prior = await tx.operationLog.findUnique({ where: { id: target.receiptId } });
        observed = Boolean(prior);
        const existing = prior ? this.decode(prior, target) : null;
        if (await this.hasSuccess(target.binding, tx)) {
          if (existing) throw new OriginalDraftRejectionUnknownError();
          await check(tx); return null;
        }
        if (existing) {
          // Rejection is terminal for this operation; a later review cannot
          // replace its original proof or authorize the same key again.
          await check(tx); return existing;
        }
        if (await isStale(tx) !== true) { await check(tx); return null; }
        await check(tx);
        const at = this.clock();
        if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const operation = aiTaskDraftRejectedOperation.parse({ state: 'rejected_no_commit', receiptId: target.receiptId,
          reason: 'revision_conflict', reviewHash, recordedAt: at.toISOString(), nextAction: 'prepare_new_proposal',
          retryable: false, businessDraft: 'not_written', publication: 'not_attempted' });
        const proof = { version: proofVersion, action, binding: target.binding, bindingHash: target.bindingHash, operation };
        attempted = true;
        const row = await tx.operationLog.create({ data: { id: target.receiptId, tenantId: scope.tenantId,
          workspaceId: scope.workspaceId, userId: scope.actorId, rentalOrderId: null, action,
          detail: { ...proof, receiptHash: requestFingerprint(proof) }, createdAt: at } });
        const saved = this.decode(row, target);
        await check(tx);
        return saved;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      await check();
      if (!result) return null;
      const saved = await this.read(target.binding);
      if (!saved || requestFingerprint(saved) !== requestFingerprint(result)) throw new OriginalDraftRejectionUnknownError();
      await check();
      return saved;
    } catch (error) {
      if (attempted || observed) throw new OriginalDraftRejectionUnknownError();
      throw error;
    }
  }
}
