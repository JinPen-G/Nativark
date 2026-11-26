/** Original admission rows and single-winner dispatch CAS. Public tenant
 * writes require the owning Task transaction. Original-token finish is bookkeeping. */
import { randomUUID } from 'node:crypto';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { isGatewayConfig, ModelGatewayError, dispatchBindingSchema, dispatchOutcomeSchema,
  admissionCallIdSchema, admissionInputSchema, admissionPatchSchema, admissionRecordSchema, admissionScopeSchema, admissionStatusSchema,
  type AiProfileScope, type AdmissionRepository, type AiAdmissionStatus, type AiInvocationAdmissionRecord, type CreateAiInvocationAdmission,
  type AdmissionDispatchRepository, type AiDispatchBinding, type AiDispatchOutcome } from '@rental-os/platform-server/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import type { Prisma, PrismaClient } from '@prisma/client';
import { isStrictAiTaskTransactionBoundary, type AiTaskTransactionBoundary } from '../task-transactions';
import { AiTaskRepositoryError } from '../task-errors';
import { aiPersistenceScopeColumns } from './persistence-scope';

const select = {
  id: true, scopeKind: true, platformDedupKey: true, tenantId: true, workspaceId: true, actorId: true, callId: true, requestHash: true, profileId: true,
  status: true, dispatchId: true, unknownReason: true, expiresAt: true, admittedAt: true, updatedAt: true, revokedAt: true, completedAt: true
} satisfies Prisma.AiInvocationAdmissionSelect;
type Row = Prisma.AiInvocationAdmissionGetPayload<{ select: typeof select }>;
type Scope = ReturnType<typeof admissionScopeSchema.parse>;
type Tx = Prisma.TransactionClient;
type Db = Pick<PrismaClient, 'aiScope' | 'aiInvocationAdmission' | '$transaction'>;
type Transactions = Pick<AiTaskTransactionBoundary<Tx>, 'withAiTaskTransaction' | 'hasAiTaskTransactionAuthority'>;
const attribution = (scope: Scope) => ({ scopeKind: scope.kind, tenantId: 'tenantId' in scope ? scope.tenantId : null,
  workspaceId: 'workspaceId' in scope ? scope.workspaceId : null });
const filter = (scope: Scope, callId: string): Prisma.AiInvocationAdmissionWhereInput => ({ ...attribution(scope), callId });

function record(row: Row, scope: Scope, callId: string): AiInvocationAdmissionRecord {
  const expected = attribution(scope);
  if (row.scopeKind !== expected.scopeKind || row.tenantId !== expected.tenantId || row.workspaceId !== expected.workspaceId
    || row.callId !== callId || scope.kind === 'TENANT' && row.platformDedupKey !== null) throw new ModelGatewayError('CONFIG_INVALID');
  const { tenantId: _, workspaceId: __, scopeKind: ___, platformDedupKey: ____, ...fields } = row;
  const parsed = admissionRecordSchema.safeParse({ ...fields, scope });
  if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
  return parsed.data;
}

export class PrismaAdmissionPersistenceRepository implements AdmissionRepository, AdmissionDispatchRepository {
  constructor(private readonly prisma: Db, private readonly transactions: Transactions,
    private readonly consumer: 'tenant' | 'legacy', private readonly clock: () => Date = () => new Date()) {
    if (consumer === 'tenant' && !isStrictAiTaskTransactionBoundary(transactions)) throw new ModelGatewayError('CONFIG_INVALID');
  }

  private parseScope(value: AiProfileScope): Scope {
    const parsed = admissionScopeSchema.safeParse(value);
    if (!parsed.success || (parsed.data.kind === 'TENANT') !== (this.consumer === 'tenant')) throw new ModelGatewayError('INVALID_REQUEST');
    return parsed.data;
  }

  private async assertScope(scope: Scope, db: Pick<Tx, 'aiScope'>) {
    const { scopeKind: kind, tenantId, workspaceId } = attribution(scope);
    const scopeKey = scope.kind === 'TENANT' ? aiPersistenceScopeColumns({ kind: 'tenant', tenantId: scope.tenantId }).scopeKey : undefined;
    const row = await db.aiScope.findFirst({ where: { id: scope.id, kind, tenantId, workspaceId, ...(scopeKey ? { scopeKey } : {}) },
      select: { id: true, kind: true, tenantId: true, workspaceId: true, scopeKey: true } });
    if (!row || row.id !== scope.id || row.kind !== kind || row.tenantId !== tenantId || row.workspaceId !== workspaceId
      || scopeKey !== undefined && row.scopeKey !== scopeKey) throw new ModelGatewayError('CONFIG_INVALID');
  }

  private async withTask<T>(tx: Tx, scope: Scope, callId: string, actorId: string, work: () => Promise<T>) {
    try {
      return await this.transactions.withAiTaskTransaction(tx, { kind: 'invocation', callId,
        ...(scope.kind === 'TENANT' ? { tenantSubject: { tenantId: scope.tenantId, actorId } } : {}) }, work);
    } catch (error) {
      if (scope.kind === 'TENANT' && error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED')
        throw new ModelGatewayError('FORBIDDEN');
      throw error;
    }
  }

  private async originalExpiry(tx: Tx, scope: Extract<Scope, { kind: 'TENANT' }>,
    input: Pick<CreateAiInvocationAdmission, 'callId' | 'actorId' | 'profileId'>) {
    const row = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: scope.id, callId: input.callId } },
      select: { scopeId: true, callId: true, actorId: true, configuration: true, configurationHash: true, expiresAt: true } });
    if (!row || row.scopeId !== scope.id || row.callId !== input.callId || row.actorId !== input.actorId
      || !isGatewayConfig(row.configuration) || !('tenantId' in row.configuration) || row.configuration.tenantId !== scope.tenantId
      || row.configuration.configId !== input.profileId || requestFingerprint(row.configuration) !== row.configurationHash
      || !(row.expiresAt instanceof Date) || !(row.expiresAt > this.clock())) throw new ModelGatewayError('FORBIDDEN');
    return row.expiresAt;
  }

  async get(value: AiProfileScope, callId: string) {
    if (!admissionCallIdSchema.safeParse(callId).success) throw new ModelGatewayError('INVALID_REQUEST');
    const scope = this.parseScope(value);
    await this.assertScope(scope, this.prisma);
    const row = await this.prisma.aiInvocationAdmission.findFirst({ where: filter(scope, callId), select });
    return row === null ? null : record(row, scope, callId);
  }

  async create(value: CreateAiInvocationAdmission) {
    const parsed = admissionInputSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = structuredClone(parsed.data), scope = this.parseScope(input.scope);
    const create = (db: Pick<Tx, 'aiInvocationAdmission'>, expiresAt: Date) => db.aiInvocationAdmission.create({ data: {
      id: randomUUID(), ...attribution(scope), ...(scope.kind === 'PLATFORM' ? { platformDedupKey: input.callId } : {}),
      actorId: input.actorId,
      callId: input.callId, requestHash: input.requestHash, profileId: input.profileId ?? null, status: 'admitted', expiresAt
    }, select });
    if (scope.kind !== 'TENANT') await this.assertScope(scope, this.prisma);
    const row = this.transactions.hasAiTaskTransactionAuthority()
      ? await this.prisma.$transaction(tx => this.withTask(tx, scope, input.callId, input.actorId, async () => {
        await this.assertScope(scope, tx);
        const origin = scope.kind === 'TENANT' ? await this.originalExpiry(tx, scope, input) : input.expiresAt;
        const expiresAt = origin < input.expiresAt ? origin : input.expiresAt;
        if (scope.kind === 'TENANT' && expiresAt <= this.clock()) throw new ModelGatewayError('FORBIDDEN');
        return create(tx, expiresAt);
      }), { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 })
      : await create(this.prisma, input.expiresAt);
    return record(row, scope, input.callId);
  }

  async claimDispatch(binding: AiDispatchBinding) {
    return this.dispatch(binding, null);
  }

  async finishDispatch(binding: AiDispatchBinding, outcome: AiDispatchOutcome) {
    if (!dispatchOutcomeSchema.safeParse(outcome).success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.dispatch(binding, outcome);
  }

  private async dispatch(value: AiDispatchBinding, outcome: AiDispatchOutcome | null) {
    const parsed = dispatchBindingSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const binding = structuredClone(parsed.data), scope = this.parseScope(binding.scope);
    return this.prisma.$transaction(async tx => {
      const originalWork = async () => {
        await this.assertScope(scope, tx);
        const origin = scope.kind === 'TENANT' && outcome === null ? await this.originalExpiry(tx, scope, binding) : undefined;
        const now = this.clock();
        if (origin && origin <= now) throw new ModelGatewayError('FORBIDDEN');
        const exact = { ...filter(scope, binding.callId), id: binding.id, actorId: binding.actorId,
          requestHash: binding.requestHash, profileId: binding.profileId };
        const result = await tx.aiInvocationAdmission.updateMany({
          where: { ...exact, status: 'admitted', dispatchId: outcome === null ? null : binding.dispatchId,
            revokedAt: null, completedAt: null, ...(outcome === null ? { expiresAt: { gt: now } } : {}) },
          data: outcome === null ? { dispatchId: binding.dispatchId } : { status: outcome,
            ...(outcome === 'completed' ? { completedAt: now } : {}),
            ...(outcome === 'cancelled' ? { revokedAt: now } : {}),
            ...(outcome === 'unknown' ? { unknownReason: 'dispatch_outcome_unknown' } : {}) }
        });
        if (result.count === 0) return null;
        if (result.count !== 1) throw new ModelGatewayError('CONFIG_INVALID');
        const row = await tx.aiInvocationAdmission.findFirst({
          where: { ...exact, dispatchId: binding.dispatchId, status: outcome ?? 'admitted' }, select
        });
        if (!row) throw new ModelGatewayError('CONFIG_INVALID');
        const projected = record(row, scope, binding.callId);
        if (projected.id !== binding.id || projected.actorId !== binding.actorId || projected.requestHash !== binding.requestHash
          || projected.profileId !== binding.profileId || projected.dispatchId !== binding.dispatchId
          || projected.status !== (outcome ?? 'admitted')) throw new ModelGatewayError('CONFIG_INVALID');
        if (origin && (origin <= this.clock() || projected.expiresAt <= this.clock())) throw new ModelGatewayError('FORBIDDEN');
        return projected;
      };
      return outcome === null ? this.withTask(tx, scope, binding.callId, binding.actorId, originalWork) : originalWork();
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }

  async transition(value: AiProfileScope, callId: string, from: AiAdmissionStatus, to: AiAdmissionStatus, patch: { dispatchId?: string | null; unknownReason?: string | null } = {}) {
    const scopeInput = admissionScopeSchema.safeParse(value), changes = admissionPatchSchema.safeParse(patch);
    if (!scopeInput.success || !changes.success || changes.data.dispatchId !== undefined || !admissionCallIdSchema.safeParse(callId).success
      || !admissionStatusSchema.safeParse(from).success || !admissionStatusSchema.safeParse(to).success) throw new ModelGatewayError('INVALID_REQUEST');
    const scope = this.parseScope(scopeInput.data), update = structuredClone(changes.data);
    if (scope.kind === 'TENANT') throw new ModelGatewayError('INVALID_REQUEST');
    return this.prisma.$transaction(async tx => {
      await this.assertScope(scope, tx);
      const before = await tx.aiInvocationAdmission.findFirst({ where: { ...filter(scope, callId), status: from }, select });
      if (!before) return null;
      record(before, scope, callId);
      // Legacy bookkeeping has no dispatch token and must never mutate a claimed invocation.
      if (before.dispatchId !== null) throw new ModelGatewayError('CONFIG_INVALID');
      const now = this.clock();
      const result = await tx.aiInvocationAdmission.updateMany({
        where: { ...filter(scope, callId), id: before.id, actorId: before.actorId, requestHash: before.requestHash,
          profileId: before.profileId, status: from, dispatchId: before.dispatchId, updatedAt: before.updatedAt },
        data: { status: to, ...update, ...(to === 'revoked' || to === 'cancelled' ? { revokedAt: now } : {}), ...(to === 'completed' ? { completedAt: now } : {}) }
      });
      if (result.count !== 1) throw new ModelGatewayError('CONFIG_INVALID');
      const after = await tx.aiInvocationAdmission.findFirst({ where: { ...filter(scope, callId), id: before.id, status: to }, select });
      if (!after) throw new ModelGatewayError('CONFIG_INVALID');
      // Read back under the same transaction, never return a later concurrent transition as ours.
      return record(after, scope, callId);
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
}
