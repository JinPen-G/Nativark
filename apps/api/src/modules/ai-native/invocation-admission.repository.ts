import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileScope } from './provider-profile.ports';
import type { AdmissionRepository, AiAdmissionStatus, AiInvocationAdmissionRecord, CreateAiInvocationAdmission } from './invocation-admission.ports';
import { dispatchBindingSchema, dispatchOutcomeSchema, type AdmissionDispatchRepository, type AiDispatchBinding, type AiDispatchOutcome } from './invocation-dispatch.service';
import { admissionCallIdSchema, admissionInputSchema, admissionPatchSchema, admissionRecordSchema, admissionScopeSchema, admissionStatusSchema } from './invocation-admission.validation';

const select = {
  id: true, scopeKind: true, platformDedupKey: true, tenantId: true, workspaceId: true, actorId: true, callId: true, requestHash: true, profileId: true,
  status: true, dispatchId: true, unknownReason: true, expiresAt: true, admittedAt: true, updatedAt: true, revokedAt: true, completedAt: true
} satisfies Prisma.AiInvocationAdmissionSelect;
type Row = Prisma.AiInvocationAdmissionGetPayload<{ select: typeof select }>;
type Scope = ReturnType<typeof admissionScopeSchema.parse>;
const filter = (scope: Scope, callId: string): Prisma.AiInvocationAdmissionWhereInput => scope.kind === 'PLATFORM'
  ? { scopeKind: 'PLATFORM', tenantId: null, workspaceId: null, callId }
  : { tenantId: scope.tenantId, workspaceId: scope.workspaceId, callId };

/** Compare a stored admission row's attribution against either scope member:
 * workspace rows keep tenant/workspace equality; platform rows require the
 * platform scope kind with null attribution. */
function attributionMatches(scope: Scope, row: { scopeKind?: string | null; tenantId?: string | null; workspaceId?: string | null }): boolean {
  return scope.kind === 'PLATFORM'
    ? row.scopeKind === 'PLATFORM' && row.tenantId == null && row.workspaceId == null
    : row.scopeKind === 'WORKSPACE' && row.tenantId === scope.tenantId && row.workspaceId === scope.workspaceId;
}

function record(row: Row, scope: Scope, callId: string): AiInvocationAdmissionRecord {
  if (!attributionMatches(scope, row) || row.callId !== callId) throw new ModelGatewayError('CONFIG_INVALID');
  const { tenantId: _, workspaceId: __, scopeKind: ___, platformDedupKey: ____, ...fields } = row;
  const parsed = admissionRecordSchema.safeParse({ ...fields, scope });
  if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
  return parsed.data;
}

/** Real generated delegates; the current table only represents workspace admissions.
 * This repository does not turn an internal scope argument into authorization.
 */
export class PrismaAdmissionRepository implements AdmissionRepository, AdmissionDispatchRepository {
  constructor(private readonly prisma: Pick<PrismaClient, 'aiScope' | 'aiInvocationAdmission' | '$transaction'>) {}

  private async scope(value: AiProfileScope, db: Pick<Prisma.TransactionClient, 'aiScope'> = this.prisma): Promise<Scope> {
    const parsed = admissionScopeSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const scope = structuredClone(parsed.data);
    if (scope.kind === 'PLATFORM') {
      const row = await db.aiScope.findFirst({ where: { id: scope.id, kind: 'PLATFORM', tenantId: null, workspaceId: null }, select: { id: true, kind: true, tenantId: true, workspaceId: true } });
      if (!row || row.id !== scope.id || row.kind !== 'PLATFORM' || row.tenantId !== null || row.workspaceId !== null) throw new ModelGatewayError('CONFIG_INVALID');
      return scope;
    }
    const row = await db.aiScope.findFirst({ where: { id: scope.id, kind: 'WORKSPACE', tenantId: scope.tenantId, workspaceId: scope.workspaceId }, select: { id: true, kind: true, tenantId: true, workspaceId: true } });
    if (!row || row.id !== scope.id || row.kind !== scope.kind || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId) throw new ModelGatewayError('CONFIG_INVALID');
    return scope;
  }

  async get(value: AiProfileScope, callId: string) {
    if (!admissionCallIdSchema.safeParse(callId).success) throw new ModelGatewayError('INVALID_REQUEST');
    const scope = await this.scope(value);
    const row = await this.prisma.aiInvocationAdmission.findFirst({ where: filter(scope, callId), select });
    return row === null ? null : record(row, scope, callId);
  }

  async create(value: CreateAiInvocationAdmission) {
    const parsed = admissionInputSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = structuredClone(parsed.data), scope = await this.scope(input.scope);
    const row = await this.prisma.aiInvocationAdmission.create({ data: {
      id: randomUUID(), scopeKind: scope.kind === 'PLATFORM' ? 'PLATFORM' : 'WORKSPACE',
      ...(scope.kind === 'PLATFORM' ? { platformDedupKey: input.callId, tenantId: null, workspaceId: null }
        : { tenantId: scope.tenantId, workspaceId: scope.workspaceId }),
      actorId: input.actorId,
      callId: input.callId, requestHash: input.requestHash, profileId: input.profileId ?? null, status: 'admitted', expiresAt: input.expiresAt
    }, select });
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
    const binding = structuredClone(parsed.data);
    return this.prisma.$transaction(async tx => {
      const scope = await this.scope(binding.scope, tx), now = new Date();
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
      return projected;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }

  async transition(value: AiProfileScope, callId: string, from: AiAdmissionStatus, to: AiAdmissionStatus, patch: { dispatchId?: string | null; unknownReason?: string | null } = {}) {
    const scopeInput = admissionScopeSchema.safeParse(value), changes = admissionPatchSchema.safeParse(patch);
    if (!scopeInput.success || !changes.success || changes.data.dispatchId !== undefined || !admissionCallIdSchema.safeParse(callId).success
      || !admissionStatusSchema.safeParse(from).success || !admissionStatusSchema.safeParse(to).success) throw new ModelGatewayError('INVALID_REQUEST');
    const scopeValue = structuredClone(scopeInput.data), update = structuredClone(changes.data);
    return this.prisma.$transaction(async tx => {
      const scope = await this.scope(scopeValue, tx);
      const before = await tx.aiInvocationAdmission.findFirst({ where: { ...filter(scope, callId), status: from }, select });
      if (!before) return null;
      record(before, scope, callId);
      // Legacy bookkeeping has no dispatch token and must never mutate a claimed invocation.
      if (before.dispatchId !== null) throw new ModelGatewayError('CONFIG_INVALID');
      const now = new Date();
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
}
