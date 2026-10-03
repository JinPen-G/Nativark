import { Prisma } from '@prisma/client';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileScope } from './provider-profile.ports';
import type { AdmissionRepository, AiAdmissionStatus, AiInvocationAdmissionRecord, CreateAiInvocationAdmission } from './invocation-admission.ports';
import { admissionCallIdSchema, admissionInputSchema, admissionPatchSchema, admissionRecordSchema, admissionScopeSchema, admissionStatusSchema } from './invocation-admission.validation';

const terminal = new Set<AiAdmissionStatus>(['revoked', 'cancelled', 'completed']);
/** Internal workspace admission bookkeeping, not an identity resolver or dispatch permit.
 * Actor kind/audience, platform admission and single-winner dispatch require the next contract slice.
 */
export class InvocationAdmissionService {
  constructor(private readonly repository: AdmissionRepository, private readonly clock: () => Date = () => new Date()) {
    if (!repository || [repository.get, repository.create, repository.transition].some(fn => typeof fn !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  }

  private now() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
    return now;
  }

  private replay(value: unknown, input: CreateAiInvocationAdmission): AiInvocationAdmissionRecord {
    const parsed = admissionRecordSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
    const row = parsed.data;
    if (row.actorId !== input.actorId || row.callId !== input.callId || row.requestHash !== input.requestHash
      || row.profileId !== (input.profileId ?? null) || row.scope.kind !== input.scope.kind || row.scope.id !== input.scope.id
      || row.scope.tenantId !== input.scope.tenantId || row.scope.workspaceId !== input.scope.workspaceId) throw new ModelGatewayError('CONFIG_INVALID');
    if (row.status === 'unknown') throw new ModelGatewayError('ACCOUNTING_PENDING');
    if (row.status !== 'admitted' || row.expiresAt <= this.now() || row.revokedAt !== null || row.completedAt !== null || row.dispatchId !== null) throw new ModelGatewayError('INVALID_REQUEST');
    return structuredClone(row);
  }

  async admit(value: CreateAiInvocationAdmission): Promise<AiInvocationAdmissionRecord> {
    const parsed = admissionInputSchema.safeParse(value);
    if (!parsed.success || parsed.data.expiresAt <= this.now()) throw new ModelGatewayError('INVALID_REQUEST');
    // Copy before any await: callers and repository implementations cannot replace the binding mid-flight.
    const input = structuredClone(parsed.data);
    let existing: AiInvocationAdmissionRecord | null;
    try { existing = await this.repository.get(structuredClone(input.scope), input.callId); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    if (existing) return this.replay(existing, input);
    if (input.expiresAt <= this.now()) throw new ModelGatewayError('INVALID_REQUEST');
    let created: AiInvocationAdmissionRecord;
    try { created = await this.repository.create(structuredClone(input)); }
    catch (error) {
      // Only a definite uniqueness failure is safe to resolve by reading a winner.
      // A timeout/disconnect may have committed; do not conceal it or retry the write.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw new ModelGatewayError('CONFIG_INVALID');
      let raced: AiInvocationAdmissionRecord | null;
      try { raced = await this.repository.get(structuredClone(input.scope), input.callId); }
      catch { throw new ModelGatewayError('CONFIG_INVALID'); }
      if (!raced) throw new ModelGatewayError('CONFIG_INVALID');
      return this.replay(raced, input);
    }
    return this.replay(created, input);
  }

  async transition(scope: AiProfileScope, callId: string, from: AiAdmissionStatus, to: AiAdmissionStatus, patch?: { dispatchId?: string | null; unknownReason?: string | null }) {
    const parsedScope = admissionScopeSchema.safeParse(scope), parsedPatch = admissionPatchSchema.safeParse(patch ?? {});
    if (!parsedScope.success || !admissionCallIdSchema.safeParse(callId).success || !admissionStatusSchema.safeParse(from).success
      || !admissionStatusSchema.safeParse(to).success || !parsedPatch.success) throw new ModelGatewayError('INVALID_REQUEST');
    if (from === 'unknown' && to !== 'completed' && to !== 'cancelled') throw new ModelGatewayError('ACCOUNTING_PENDING');
    if (terminal.has(from) || (to !== 'revoked' && to !== 'cancelled' && to !== 'completed' && to !== 'unknown')) throw new ModelGatewayError('CONFIG_INVALID');
    let next: AiInvocationAdmissionRecord | null;
    try { next = await this.repository.transition(structuredClone(parsedScope.data), callId, from, to, structuredClone(parsedPatch.data)); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    const parsed = admissionRecordSchema.safeParse(next);
    if (!parsed.success || parsed.data.callId !== callId || parsed.data.status !== to
      || parsed.data.scope.id !== scope.id || parsed.data.scope.tenantId !== scope.tenantId || parsed.data.scope.workspaceId !== scope.workspaceId) throw new ModelGatewayError('CONFIG_INVALID');
    return structuredClone(parsed.data);
  }
}
