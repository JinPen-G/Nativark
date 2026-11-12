/** Explicit current-human metadata grants. The published policy and original
 * review target are mandatory; reads never enable or renew. The existing grant
 * row is current authority, and original OperationLog receipts preserve each
 * admitted policy/permission/expiry snapshot without another table. */
import { Prisma, type PrismaClient, type OperationLog } from '@prisma/client';
import { z } from 'zod';
import { hasEffectivePermission } from '../../../common/permission-match';
import { requestFingerprint as fingerprint } from '../../rental-core/rental-idempotency.repository';
import { HumanAutomationReviewError, type HumanAutomationOriginalGrantTarget,
  type HumanAutomationReviewGrantTarget, type HumanAutomationReviewService } from './human-automation-review.service';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().min(1).max(4294967293);
const instant = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
// Publication supplies original concrete permission codes. Neither '*' nor
// the current actor's permission list can become a policy declaration.
const permission = id;
const permissions = z.array(permission).min(1).max(64)
  .refine(values => new Set(values).size === values.length).transform(values => [...values].sort());
const actionPolicy = z.object({ requiredPermissions: permissions }).strict();
export const humanAutomationReviewGrantPolicySchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), policyId: id, revision,
    scope: z.object({ tenantId: id, workspaceId: id }).strict(), validFrom: instant, expiresAt: instant,
    actions: z.object({ close: actionPolicy, feedback: actionPolicy }).strict(),
    maxGrantTtlMs: z.number().int().positive().safe() }).strict(),
]).refine(policy => !policy.enabled || Date.parse(policy.validFrom) < Date.parse(policy.expiresAt));
export type HumanAutomationReviewGrantPolicy = z.infer<typeof humanAutomationReviewGrantPolicySchema>;
type EnabledPolicy = Extract<HumanAutomationReviewGrantPolicy, { enabled: true }>;
export interface HumanAutomationReviewGrantPolicySource {
  /** Trusted runtime publication only. Missing/disabled is unavailable for writes. */
  read(target: HumanAutomationReviewGrantTarget): Promise<unknown>;
}

const querySchema = z.object({ inputRef: uuid, action: z.enum(['close', 'feedback']) }).strict();
const keySchema = z.object({ tenantId: id, workspaceId: id, scopeId: id.max(36), userId: id,
  actorKind: z.literal('user'), actorId: id, audience: z.enum(['operator', 'staff']), inputId: uuid,
  eventId: uuid, action: z.enum(['close', 'feedback']), expectedRevision: revision }).strict()
  .refine(value => value.actorId === value.userId);
type Key = z.infer<typeof keySchema>;
const policyReferenceSchema = z.object({ policyId: id, revision, fingerprint: hash }).strict();
const preparationSchema = z.object({ version: z.literal('human-automation-review-grant-1'), state: z.literal('prepared'),
  preparedRef: hash, key: keySchema, grantId: id.max(36), expectedGrantRevision: revision.nullable(), previousGrantFingerprint: hash.nullable(),
  targetFingerprint: hash, principalFingerprint: hash, sourceFingerprint: hash,
  resourceHash: hash, inputHash: hash, creationKey: id, policy: policyReferenceSchema,
  requiredPermissions: permissions, preparedAt: instant, expiresAt: instant,
  executionPermission: z.literal(false), businessActionRequested: z.literal(false) }).strict()
  .refine(value => (value.expectedGrantRevision === null) === (value.previousGrantFingerprint === null));
export type HumanAutomationReviewGrantPreparation = z.infer<typeof preparationSchema>;
const receiptSchema = z.object({ version: z.literal('human-automation-review-grant-1'), preparedRef: hash,
  key: keySchema, grantId: id.max(36), grantRevision: revision, expectedGrantRevision: revision.nullable(),
  previousGrantFingerprint: hash.nullable(),
  targetFingerprint: hash, principalFingerprint: hash, sourceFingerprint: hash,
  resourceHash: hash, inputHash: hash, creationKey: id, policy: policyReferenceSchema,
  requiredPermissions: permissions, preparedAt: instant, expiresAt: instant, enabledAtCommit: z.literal(true), recordedAt: instant }).strict();
export type HumanAutomationReviewGrantReceipt = z.infer<typeof receiptSchema>;
const readSchema = querySchema.extend({ expectedRevision: revision, preparedRef: hash.optional() }).strict();
const semantics = { executionPermission: false as const, businessActionRequested: false as const,
  automaticRetry: false as const, semantics: 'human_review_metadata_only' as const };
const action = 'ai_automation_review_grant_enabled';
const unavailable = () => new HumanAutomationReviewError('unavailable');
const conflict = () => new HumanAutomationReviewError('conflict');
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HumanAutomationReviewError('invalid_input');
  return result.data;
}
const same = (left: unknown, right: unknown) => fingerprint(left) === fingerprint(right);
const rowSelect = { id: true, tenantId: true, workspaceId: true, scopeId: true, inputId: true, eventId: true,
  actorKind: true, actorId: true, audience: true, action: true, expectedRevision: true, resourceHash: true,
  requiredPermissions: true, revision: true, enabled: true, expiresAt: true } satisfies Prisma.AiAutomationReviewGrantSelect;
export type HumanAutomationReviewGrantDb = Pick<PrismaClient, 'aiAutomationInput' | 'aiBusinessFailureOutbox' | 'aiScope' | 'aiTask'
  | 'aiAutomationReviewGrant' | 'aiAutomationReviewOperation' | 'operationLog'>;
type Db = HumanAutomationReviewGrantDb & Pick<PrismaClient, '$transaction' | '$queryRaw'>;
type StoredGrant = Prisma.AiAutomationReviewGrantGetPayload<{ select: typeof rowSelect }>;

function deterministicId(value: unknown) {
  const chars = fingerprint(value).slice(0, 32).split('');
  chars[12] = '5'; chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
  const text = chars.join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
const receiptId = (preparedRef: string) => deterministicId({ version: 'human-automation-review-grant-receipt-1', preparedRef });
const grantId = (key: Key) => deterministicId({ version: 'human-automation-review-grant-key-1', key });
const storedKey = (key: Key) => ({ scopeId: key.scopeId, actorId: key.actorId, audience: key.audience,
  inputId: key.inputId, action: key.action, expectedRevision: key.expectedRevision });
function targetKey(target: HumanAutomationReviewGrantTarget, expectedRevision = target.expectedRevision): Key {
  return keySchema.parse({ tenantId: target.tenantId, workspaceId: target.workspaceId, scopeId: target.scopeId,
    userId: target.userId, actorKind: target.actorKind, actorId: target.actorId, audience: target.audience,
    inputId: target.inputId, eventId: target.eventId, action: target.action, expectedRevision });
}
function grantSnapshot(row: StoredGrant, key: Key) {
  if (!row || row.tenantId !== key.tenantId || row.workspaceId !== key.workspaceId || row.eventId !== key.eventId
    || row.actorKind !== 'user' || Object.entries(storedKey(key)).some(([name, value]) => row[name as keyof StoredGrant] !== value)
    || !id.max(36).safeParse(row.id).success || !revision.safeParse(row.revision).success || !hash.safeParse(row.resourceHash).success
    || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || typeof row.enabled !== 'boolean') throw unavailable();
  const concrete = permissions.safeParse(row.requiredPermissions);
  if (!concrete.success) throw unavailable();
  return { id: row.id, key, revision: row.revision, enabled: row.enabled, resourceHash: row.resourceHash,
    requiredPermissions: concrete.data, expiresAt: row.expiresAt.toISOString() };
}

export class HumanAutomationReviewGrantService {
  constructor(private readonly db: Db, private readonly reviews: Pick<HumanAutomationReviewService, 'withGrantTarget'>,
    private readonly policySource: HumanAutomationReviewGrantPolicySource, private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof db.$queryRaw !== 'function'
      || typeof db.aiAutomationReviewGrant?.findFirst !== 'function' || typeof db.aiAutomationReviewGrant.create !== 'function'
      || typeof db.aiAutomationReviewGrant.updateMany !== 'function' || typeof db.operationLog?.findFirst !== 'function'
      || typeof db.operationLog.findMany !== 'function' || typeof db.operationLog.create !== 'function'
      || typeof reviews?.withGrantTarget !== 'function' || typeof policySource?.read !== 'function') throw unavailable();
  }

  private async policy(target: HumanAutomationReviewGrantTarget) {
    const value = humanAutomationReviewGrantPolicySchema.safeParse(await this.policySource.read(structuredClone(target)));
    const now = this.clock();
    if (!value.success || !value.data.enabled || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
    const policy = value.data, context = target.context;
    if (context.actor.kind !== 'user' || !('access' in context)) throw unavailable();
    const heldPermissions = context.access.permissions;
    if (policy.scope.tenantId !== target.tenantId || policy.scope.workspaceId !== target.workspaceId
      || Date.parse(policy.validFrom) > now.getTime() || Date.parse(policy.expiresAt) <= now.getTime()
      || policy.actions[target.action].requiredPermissions.some(code => !hasEffectivePermission(heldPermissions, code))) throw unavailable();
    return { value: policy, reference: { policyId: policy.policyId, revision: policy.revision, fingerprint: fingerprint(policy) } };
  }

  private async grant(db: HumanAutomationReviewGrantDb, key: Key) {
    const row = await db.aiAutomationReviewGrant.findFirst({ where: { ...storedKey(key), tenantId: key.tenantId,
      workspaceId: key.workspaceId, eventId: key.eventId }, select: rowSelect });
    if (row) grantSnapshot(row, key);
    return row;
  }

  private receipt(log: Pick<OperationLog, 'id' | 'tenantId' | 'workspaceId' | 'userId' | 'action' | 'detail'>, key: Key) {
    const parsed = receiptSchema.safeParse(log.detail);
    if (!parsed.success || log.id !== receiptId(parsed.data.preparedRef) || log.action !== action
      || log.tenantId !== key.tenantId || log.workspaceId !== key.workspaceId || log.userId !== key.userId
      || !same(parsed.data.key, key) || parsed.data.grantRevision !== (parsed.data.expectedGrantRevision ?? 0) + 1) throw unavailable();
    const receipt = parsed.data;
    const prepared = preparationSchema.safeParse({ version: receipt.version, state: 'prepared', preparedRef: receipt.preparedRef,
      key: receipt.key, grantId: receipt.grantId, expectedGrantRevision: receipt.expectedGrantRevision,
      previousGrantFingerprint: receipt.previousGrantFingerprint, targetFingerprint: receipt.targetFingerprint,
      principalFingerprint: receipt.principalFingerprint, sourceFingerprint: receipt.sourceFingerprint,
      resourceHash: receipt.resourceHash, inputHash: receipt.inputHash, creationKey: receipt.creationKey,
      policy: receipt.policy, requiredPermissions: receipt.requiredPermissions, preparedAt: receipt.preparedAt,
      expiresAt: receipt.expiresAt, executionPermission: false, businessActionRequested: false });
    if (!prepared.success) throw unavailable();
    const { preparedRef, ...material } = prepared.data;
    if (fingerprint(material) !== preparedRef) throw unavailable();
    return parsed.data;
  }

  private receiptPolicyMatches(receipt: HumanAutomationReviewGrantReceipt, policy: EnabledPolicy) {
    const preparedAt = Date.parse(receipt.preparedAt);
    return same(receipt.policy, { policyId: policy.policyId, revision: policy.revision, fingerprint: fingerprint(policy) })
      && preparedAt >= Date.parse(policy.validFrom) && preparedAt <= this.clock().getTime()
      && Date.parse(receipt.expiresAt) === Math.min(Date.parse(policy.expiresAt), preparedAt + policy.maxGrantTtlMs);
  }

  private async originalReceipt(db: HumanAutomationReviewGrantDb, key: Key, preparedRef: string) {
    const log = await db.operationLog.findFirst({ where: { id: receiptId(preparedRef), action,
      tenantId: key.tenantId, workspaceId: key.workspaceId, userId: key.userId } });
    if (!log) return null;
    const receipt = this.receipt(log, key);
    if (receipt.preparedRef !== preparedRef) throw unavailable();
    return receipt;
  }

  private async currentReceipt(db: HumanAutomationReviewGrantDb, key: Key, row: StoredGrant) {
    const logs = await db.operationLog.findMany({ where: { action, tenantId: key.tenantId,
      workspaceId: key.workspaceId, userId: key.userId, AND: [
        { detail: { path: '$.grantId', equals: row.id } },
        { detail: { path: '$.grantRevision', equals: row.revision } },
      ] }, take: 2 });
    if (logs.length > 1) throw unavailable();
    const receipt = logs.length ? this.receipt(logs[0], key) : null;
    if (receipt && (receipt.grantId !== row.id || receipt.grantRevision !== row.revision)) throw unavailable();
    return receipt;
  }

  private matchesRow(row: StoredGrant, key: Key, receipt: HumanAutomationReviewGrantReceipt) {
    const current = grantSnapshot(row, key);
    return current.id === receipt.grantId && current.revision === receipt.grantRevision
      && current.resourceHash === receipt.resourceHash && same(current.requiredPermissions, receipt.requiredPermissions)
      && current.expiresAt === receipt.expiresAt;
  }

  private verifyPreparation(prepared: HumanAutomationReviewGrantPreparation, target: HumanAutomationReviewGrantTarget, policy: EnabledPolicy) {
    const { preparedRef, ...material } = prepared;
    const preparedAt = Date.parse(prepared.preparedAt), now = this.clock().getTime();
    if (preparedRef !== fingerprint(material) || !same(prepared.key, targetKey(target))
      || prepared.expectedGrantRevision === null && prepared.grantId !== grantId(prepared.key)
      || prepared.targetFingerprint !== target.targetFingerprint || prepared.principalFingerprint !== target.principalFingerprint
      || prepared.sourceFingerprint !== target.sourceFingerprint || prepared.resourceHash !== target.resourceHash
      || prepared.inputHash !== target.inputHash || prepared.creationKey !== target.creationKey
      || !same(prepared.policy, { policyId: policy.policyId, revision: policy.revision, fingerprint: fingerprint(policy) })
      || !same(prepared.requiredPermissions, policy.actions[target.action].requiredPermissions)
      || preparedAt > now || preparedAt < Date.parse(policy.validFrom) || Date.parse(prepared.expiresAt) <= now
      || Date.parse(prepared.expiresAt) !== Math.min(Date.parse(policy.expiresAt), preparedAt + policy.maxGrantTtlMs)
      || target.action === 'close' && target.reviewStatus === 'closed') throw conflict();
  }

  async prepare(value: unknown): Promise<HumanAutomationReviewGrantPreparation> {
    const query = parse(querySchema, value);
    return this.reviews.withGrantTarget(query, async target => {
      if (target.action === 'close' && target.reviewStatus === 'closed') throw conflict();
      const policy = await this.policy(target), key = targetKey(target), row = await this.grant(this.db, key);
      const now = this.clock().getTime();
      const material = { version: 'human-automation-review-grant-1' as const, state: 'prepared' as const, key,
        grantId: row?.id ?? grantId(key), expectedGrantRevision: row?.revision ?? null,
        previousGrantFingerprint: row ? fingerprint(grantSnapshot(row, key)) : null,
        targetFingerprint: target.targetFingerprint, principalFingerprint: target.principalFingerprint, sourceFingerprint: target.sourceFingerprint,
        resourceHash: target.resourceHash, inputHash: target.inputHash, creationKey: target.creationKey,
        policy: policy.reference, requiredPermissions: policy.value.actions[target.action].requiredPermissions,
        preparedAt: new Date(now).toISOString(), expiresAt: new Date(Math.min(Date.parse(policy.value.expiresAt), now + policy.value.maxGrantTtlMs)).toISOString(),
        executionPermission: false as const, businessActionRequested: false as const };
      const result = preparationSchema.parse({ ...material, preparedRef: fingerprint(material) });
      if (!same((await this.policy(target)).reference, policy.reference)) throw unavailable();
      return result;
    });
  }

  async enable(value: unknown) {
    const prepared = parse(preparationSchema, value), query = { inputRef: prepared.key.inputId, action: prepared.key.action };
    let attempted = false, acknowledged = false;
    try {
      return await this.reviews.withGrantTarget(query, async before => {
        const policy = await this.policy(before); this.verifyPreparation(prepared, before, policy.value);
        const existing = await this.originalReceipt(this.db, prepared.key, prepared.preparedRef);
        if (existing) return { state: 'observed' as const, receipt: existing, replayed: true, ...semantics };
        const receipt = await this.db.$transaction(async tx => {
          const event = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ai_business_failure_outbox WHERE id = ${before.eventId} AND tenantId = ${before.tenantId} AND workspaceId = ${before.workspaceId} FOR UPDATE`);
          const input = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ai_automation_inputs WHERE id = ${before.inputId} AND tenantId = ${before.tenantId} AND workspaceId = ${before.workspaceId} FOR UPDATE`);
          if (event.length !== 1 || event[0].id !== before.eventId || input.length !== 1 || input[0].id !== before.inputId) throw unavailable();
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_review_grants WHERE scopeId = ${before.scopeId} AND actorId = ${before.actorId} AND audience = ${before.audience} AND inputId = ${before.inputId} AND action = ${before.action} AND expectedRevision = ${before.expectedRevision} FOR UPDATE`);
          return this.reviews.withGrantTarget(query, async target => {
            const currentPolicy = await this.policy(target); this.verifyPreparation(prepared, target, currentPolicy.value);
            const replay = await this.originalReceipt(tx, prepared.key, prepared.preparedRef);
            if (replay) return replay;
            const row = await this.grant(tx, prepared.key);
            if (row ? row.id !== prepared.grantId || row.revision !== prepared.expectedGrantRevision || fingerprint(grantSnapshot(row, prepared.key)) !== prepared.previousGrantFingerprint
              : prepared.expectedGrantRevision !== null) throw conflict();
            const resultRevision = (prepared.expectedGrantRevision ?? 0) + 1;
            if (!revision.safeParse(resultRevision).success) throw unavailable();
            attempted = true;
            const fields = { resourceHash: prepared.resourceHash, requiredPermissions: prepared.requiredPermissions,
              expiresAt: new Date(prepared.expiresAt), enabled: true, revision: resultRevision };
            if (row) {
              const updated = await tx.aiAutomationReviewGrant.updateMany({ where: { id: row.id, ...storedKey(prepared.key),
                tenantId: prepared.key.tenantId, workspaceId: prepared.key.workspaceId, eventId: prepared.key.eventId,
                revision: row.revision, enabled: row.enabled, expiresAt: row.expiresAt, resourceHash: row.resourceHash }, data: fields });
              if (updated.count !== 1) throw conflict();
            } else {
              await tx.aiAutomationReviewGrant.create({ data: { id: prepared.grantId, ...storedKey(prepared.key),
                tenantId: prepared.key.tenantId, workspaceId: prepared.key.workspaceId, eventId: prepared.key.eventId,
                actorKind: 'user', ...fields } });
            }
            const detail = receiptSchema.parse({ version: prepared.version, preparedRef: prepared.preparedRef, key: prepared.key,
              grantId: prepared.grantId, grantRevision: resultRevision, expectedGrantRevision: prepared.expectedGrantRevision,
              previousGrantFingerprint: prepared.previousGrantFingerprint,
              targetFingerprint: prepared.targetFingerprint, principalFingerprint: prepared.principalFingerprint, sourceFingerprint: prepared.sourceFingerprint,
              resourceHash: prepared.resourceHash, inputHash: prepared.inputHash, creationKey: prepared.creationKey,
              policy: prepared.policy, requiredPermissions: prepared.requiredPermissions, preparedAt: prepared.preparedAt,
              expiresAt: prepared.expiresAt, enabledAtCommit: true, recordedAt: this.clock().toISOString() });
            await tx.operationLog.create({ data: { id: receiptId(prepared.preparedRef), tenantId: prepared.key.tenantId,
              workspaceId: prepared.key.workspaceId, userId: prepared.key.userId, action, detail } });
            const stored = await this.grant(tx, prepared.key);
            if (!stored || !this.matchesRow(stored, prepared.key, detail) || !stored.enabled || stored.expiresAt <= this.clock()
              || !same((await this.policy(target)).reference, currentPolicy.reference)) throw unavailable();
            return detail;
          }, tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
        acknowledged = true;
        if (!same((await this.policy(before)).reference, policy.reference)) throw unavailable();
        return { state: 'observed' as const, receipt, replayed: false, ...semantics };
      });
    } catch (error) {
      if (attempted || acknowledged) return { state: 'unknown' as const, inputRef: prepared.key.inputId, action: prepared.key.action,
        expectedRevision: prepared.key.expectedRevision, preparedRef: prepared.preparedRef, retryable: false as const,
        nextAction: 'read_original_grant' as const, ...semantics };
      throw error;
    }
  }

  private originalMatches(current: HumanAutomationReviewGrantTarget, original: HumanAutomationOriginalGrantTarget) {
    if (!same(targetKey(current, original.expectedRevision), targetKey({ ...current, ...original }, original.expectedRevision))
      || current.principalFingerprint !== original.principalFingerprint || current.sourceFingerprint !== original.sourceFingerprint
      || current.inputHash !== original.inputHash || current.creationKey !== original.creationKey) return false;
    if (current.expectedRevision === original.expectedRevision) return same(current.resource, original.resource)
      && current.resourceHash === original.resourceHash && current.reviewStatus === original.reviewStatus && current.eventStatus === original.eventStatus;
    // The old review grant is rechecked at the original write transaction's end.
    // Only that exact one metadata transition may differ; Core/source/auth may not.
    const next = { ...original.resource, expectedRevision: original.expectedRevision + 1,
      eventFence: original.resource.eventFence + (original.action === 'close' && original.eventStatus !== 'closed' ? 1 : 0) };
    return current.expectedRevision === original.expectedRevision + 1 && same(current.resource, next)
      && current.reviewStatus === (original.action === 'close' ? 'closed' : original.reviewStatus)
      && current.eventStatus === (original.action === 'close' ? 'closed' : original.eventStatus);
  }

  /** Mandatory private consumer for close/feedback, including their original tx
   * end check. A persisted enabled row alone is never publication authority. */
  async assertCurrentGrant(inputRef: string, kind: 'close' | 'feedback', db: HumanAutomationReviewGrantDb = this.db,
    original?: HumanAutomationOriginalGrantTarget) {
    const query = parse(querySchema, { inputRef, action: kind });
    return this.reviews.withGrantTarget(query, async target => {
      if (original && !this.originalMatches(target, original)) throw unavailable();
      const policy = await this.policy(target), key = targetKey(target, original?.expectedRevision ?? target.expectedRevision);
      const row = await this.grant(db, key);
      if (!row || !row.enabled || row.expiresAt <= this.clock()) throw unavailable();
      const receipt = await this.currentReceipt(db, key, row);
      const expectedFingerprint = original ? fingerprint(original) : target.targetFingerprint;
      if (!receipt || !this.matchesRow(row, key, receipt) || receipt.targetFingerprint !== expectedFingerprint
        || receipt.resourceHash !== (original?.resourceHash ?? target.resourceHash)
        || receipt.principalFingerprint !== target.principalFingerprint || receipt.sourceFingerprint !== target.sourceFingerprint
        || !this.receiptPolicyMatches(receipt, policy.value) || !same(receipt.requiredPermissions, policy.value.actions[kind].requiredPermissions)
        || !same((await this.policy(target)).reference, policy.reference)) throw unavailable();
      return { id: row.id, revision: row.revision, policyFingerprint: policy.reference.fingerprint, preparedRef: receipt.preparedRef };
    }, db);
  }

  async read(value: unknown) {
    const query = parse(readSchema, value);
    return this.reviews.withGrantTarget({ inputRef: query.inputRef, action: query.action }, async target => {
      const key = targetKey(target, query.expectedRevision);
      let row: StoredGrant | null, receipt: HumanAutomationReviewGrantReceipt | null;
      try {
        row = await this.grant(this.db, key);
        receipt = query.preparedRef ? await this.originalReceipt(this.db, key, query.preparedRef)
          : row ? await this.currentReceipt(this.db, key, row) : null;
      } catch (error) {
        if (error instanceof HumanAutomationReviewError) throw error;
        return { state: 'unknown' as const, key, preparedRef: query.preparedRef ?? null, retryable: false as const,
          nextAction: 'read_original_grant' as const, active: false, ...semantics };
      }
      if (!row) {
        if (receipt) throw unavailable();
        return { state: 'not_observed' as const, key, preparedRef: query.preparedRef ?? null,
          receipt: null, grant: null, active: false, ...semantics };
      }
      const material = grantSnapshot(row, key);
      if (receipt && (receipt.grantId !== row.id || receipt.grantRevision > row.revision)) throw unavailable();
      if (query.preparedRef && !receipt) return { state: 'not_observed' as const, key, preparedRef: query.preparedRef,
        receipt: null, grant: material, active: false, ...semantics };
      let active = false;
      try {
        const policy = await this.policy(target);
        active = Boolean(receipt && this.matchesRow(row, key, receipt) && row.enabled && row.expiresAt > this.clock()
          && target.expectedRevision === key.expectedRevision && target.resourceHash === receipt.resourceHash
          && target.targetFingerprint === receipt.targetFingerprint && this.receiptPolicyMatches(receipt, policy.value)
          && same(receipt.requiredPermissions, policy.value.actions[query.action].requiredPermissions));
        if (!same((await this.policy(target)).reference, policy.reference)) active = false;
      } catch { /* Disabled/missing publication cannot hide a lawful old receipt or renew it. */ }
      return { state: 'observed' as const, key, preparedRef: query.preparedRef ?? receipt?.preparedRef ?? null,
        receipt, grant: material, active, ...semantics };
    });
  }
}
