import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileScope } from './provider-profile.ports';
import type { AdmissionRepository, AiAdmissionStatus, AiInvocationAdmissionRecord, CreateAiInvocationAdmission } from './invocation-admission.ports';
import { admissionCallIdSchema, admissionInputSchema, admissionPatchSchema, admissionRecordSchema, admissionScopeSchema, admissionStatusSchema } from './invocation-admission.validation';

const select = {
  id: true, tenantId: true, workspaceId: true, actorId: true, callId: true, requestHash: true, profileId: true,
  status: true, dispatchId: true, unknownReason: true, expiresAt: true, admittedAt: true, updatedAt: true, revokedAt: true, completedAt: true
} satisfies Prisma.AiInvocationAdmissionSelect;
type Row = Prisma.AiInvocationAdmissionGetPayload<{ select: typeof select }>;
type Scope = ReturnType<typeof admissionScopeSchema.parse>;
const filter = (scope: Scope, callId: string): Prisma.AiInvocationAdmissionWhereInput => ({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, callId });
function record(row: Row, scope: Scope, callId: string): AiInvocationAdmissionRecord {
  if (row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || row.callId !== callId) throw new ModelGatewayError('CONFIG_INVALID');
  const { tenantId: _, workspaceId: __, ...fields } = row;
  const parsed = admissionRecordSchema.safeParse({ ...fields, scope });
  if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
  return parsed.data;
}

/** Real generated delegates; the current table only represents workspace admissions.
 * This repository does not turn an internal scope argument into authorization.
 */
export class PrismaAdmissionRepository implements AdmissionRepository {
  constructor(private readonly prisma: Pick<PrismaClient, 'aiScope' | 'aiInvocationAdmission' | '$transaction'>) {}

  private async scope(value: AiProfileScope, db: Pick<Prisma.TransactionClient, 'aiScope'> = this.prisma): Promise<Scope> {
    const parsed = admissionScopeSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const scope = structuredClone(parsed.data);
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
      id: randomUUID(), tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorId: input.actorId,
      callId: input.callId, requestHash: input.requestHash, profileId: input.profileId ?? null, status: 'admitted', expiresAt: input.expiresAt
    }, select });
    return record(row, scope, input.callId);
  }

  async transition(value: AiProfileScope, callId: string, from: AiAdmissionStatus, to: AiAdmissionStatus, patch: { dispatchId?: string | null; unknownReason?: string | null } = {}) {
    const scopeInput = admissionScopeSchema.safeParse(value), changes = admissionPatchSchema.safeParse(patch);
    if (!scopeInput.success || !changes.success || !admissionCallIdSchema.safeParse(callId).success
      || !admissionStatusSchema.safeParse(from).success || !admissionStatusSchema.safeParse(to).success) throw new ModelGatewayError('INVALID_REQUEST');
    const scopeValue = structuredClone(scopeInput.data), update = structuredClone(changes.data);
    return this.prisma.$transaction(async tx => {
      const scope = await this.scope(scopeValue, tx);
      const before = await tx.aiInvocationAdmission.findFirst({ where: { ...filter(scope, callId), status: from }, select });
      if (!before) return null;
      record(before, scope, callId);
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
