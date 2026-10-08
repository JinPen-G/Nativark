import { z } from 'zod';
import { admissionInputSchema, admissionRecordSchema, admissionCallIdSchema } from './invocation-admission.validation';
import type { AiInvocationAdmissionRecord } from './invocation-admission.ports';
import { ModelGatewayError } from './model-gateway.ports';

export const dispatchBindingSchema = admissionInputSchema.omit({ expiresAt: true }).extend({
  id: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  profileId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).nullable(),
  dispatchId: admissionCallIdSchema
}).strict();
export type AiDispatchBinding = z.infer<typeof dispatchBindingSchema>;
export const dispatchOutcomeSchema = z.enum(['completed', 'cancelled', 'unknown']);
export type AiDispatchOutcome = z.infer<typeof dispatchOutcomeSchema>;
export interface AdmissionDispatchRepository {
  /** Atomic CAS from admitted + no token, with database-side expiry check. Never reclaim a token. */
  claimDispatch(binding: AiDispatchBinding): Promise<AiInvocationAdmissionRecord | null>;
  /** Exact admission identity + token; unknown is deliberately not automatically reconciled here. */
  finishDispatch(binding: AiDispatchBinding, outcome: AiDispatchOutcome): Promise<AiInvocationAdmissionRecord | null>;
}

/** Server-only dispatch ownership. This does not replace fresh route authorization or budget admission. */
export class InvocationDispatchService {
  constructor(private readonly repository: AdmissionDispatchRepository) {
    if (typeof repository?.claimDispatch !== 'function' || typeof repository?.finishDispatch !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }

  private binding(value: AiDispatchBinding) {
    const parsed = dispatchBindingSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    return structuredClone(parsed.data);
  }

  private result(value: unknown, binding: AiDispatchBinding, status: 'admitted' | AiDispatchOutcome) {
    const parsed = admissionRecordSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('ACCOUNTING_PENDING');
    const row = parsed.data;
    if (row.id !== binding.id || row.actorId !== binding.actorId || row.callId !== binding.callId
      || row.requestHash !== binding.requestHash || row.profileId !== binding.profileId || row.dispatchId !== binding.dispatchId
      || row.scope.id !== binding.scope.id || row.scope.kind !== binding.scope.kind
      || row.scope.tenantId !== binding.scope.tenantId || row.scope.workspaceId !== binding.scope.workspaceId || row.status !== status
      || (status === 'admitted' && (row.revokedAt !== null || row.completedAt !== null))) throw new ModelGatewayError('ACCOUNTING_PENDING');
    return structuredClone(row);
  }

  async claim(value: AiDispatchBinding) {
    const binding = this.binding(value);
    let result;
    try { result = await this.repository.claimDispatch(structuredClone(binding)); }
    catch { throw new ModelGatewayError('ACCOUNTING_PENDING'); }
    // Even the same token cannot claim again: a lost acknowledgement is not permission to dispatch twice.
    return this.result(result, binding, 'admitted');
  }

  async finish(value: AiDispatchBinding, outcome: AiDispatchOutcome) {
    const binding = this.binding(value), parsed = dispatchOutcomeSchema.safeParse(outcome);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    let result;
    try { result = await this.repository.finishDispatch(structuredClone(binding), parsed.data); }
    catch { throw new ModelGatewayError('ACCOUNTING_PENDING'); }
    return this.result(result, binding, parsed.data);
  }
}
