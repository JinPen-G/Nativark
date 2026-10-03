import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileScope } from './provider-profile.ports';
import type { AdmissionRepository, AiAdmissionStatus, AiInvocationAdmissionRecord, CreateAiInvocationAdmission } from './invocation-admission.ports';

const terminal = new Set<AiAdmissionStatus>(['revoked', 'cancelled', 'completed']);
export class InvocationAdmissionService {
  constructor(private readonly repository: AdmissionRepository) {}
  async admit(input: CreateAiInvocationAdmission): Promise<AiInvocationAdmissionRecord> {
    if (!input.scope.tenantId || !input.scope.workspaceId || !input.actorId || !input.callId || !input.requestHash || input.expiresAt.getTime() <= Date.now()) throw new ModelGatewayError('INVALID_REQUEST');
    const existing = await this.repository.get(input.scope, input.callId);
    if (existing) {
      if (existing.requestHash !== input.requestHash) throw new ModelGatewayError('CONFIG_INVALID');
      if (existing.status === 'admitted') return existing;
      if (existing.status === 'unknown') throw new ModelGatewayError('ACCOUNTING_PENDING');
      throw new ModelGatewayError('INVALID_REQUEST');
    }
    try { return await this.repository.create(input); } catch { const raced = await this.repository.get(input.scope, input.callId); if (raced?.requestHash === input.requestHash && raced.status === 'admitted') return raced; throw new ModelGatewayError('CONFIG_INVALID'); }
  }
  async transition(scope: AiProfileScope, callId: string, from: AiAdmissionStatus, to: AiAdmissionStatus, patch?: { dispatchId?: string | null; unknownReason?: string | null }) {
    if (from === 'unknown' && to !== 'completed' && to !== 'cancelled') throw new ModelGatewayError('ACCOUNTING_PENDING');
    if (terminal.has(from) || (to !== 'revoked' && to !== 'cancelled' && to !== 'completed' && to !== 'unknown')) throw new ModelGatewayError('CONFIG_INVALID');
    const next = await this.repository.transition(scope, callId, from, to, patch);
    if (!next) throw new ModelGatewayError('CONFIG_INVALID');
    return next;
  }
}
