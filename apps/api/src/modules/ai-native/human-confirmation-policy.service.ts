import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileScope } from './provider-profile.ports';
import type { MemoryConfirmationService } from './memory-confirmation.service';
export interface HumanConfirmationContext { subjectId: string; actorId: string; actorKind: 'human'; audience: 'operator' | 'staff'; scope: AiProfileScope; aclRevision: string; }
export interface ConfirmationProposal { confirmationId: string; memoryId: string; contentHash: string; revision: number; expiresAt: Date; }
export interface ConfirmationPolicySource { readProposal(scope: AiProfileScope, confirmationId: string): Promise<ConfirmationProposal | null>; aclRevision(scope: AiProfileScope, subjectId: string): Promise<string>; }
/** Policy adapter around the persistence service; it does not grant approval to models or automations. */
export class HumanConfirmationPolicyService {
  constructor(private readonly confirmations: Pick<MemoryConfirmationService, 'confirm'>, private readonly source: ConfirmationPolicySource) {}
  async confirm(context: HumanConfirmationContext, confirmationId: string, proposalHash: string) {
    if (context.actorKind !== 'human' || !['operator', 'staff'].includes(context.audience) || !context.actorId || !context.subjectId || !context.scope.tenantId || !context.scope.workspaceId || !context.aclRevision) throw new ModelGatewayError('FORBIDDEN');
    const proposal = await this.source.readProposal(context.scope, confirmationId); if (!proposal || proposal.confirmationId !== confirmationId || proposal.expiresAt.getTime() <= Date.now() || proposal.contentHash !== proposalHash) throw new ModelGatewayError('CONFIG_INVALID');
    const currentAcl = await this.source.aclRevision(context.scope, context.subjectId); if (currentAcl !== context.aclRevision) throw new ModelGatewayError('FORBIDDEN');
    return this.confirmations.confirm(context.scope, confirmationId, context.actorId, proposalHash, proposal.revision);
  }
}
