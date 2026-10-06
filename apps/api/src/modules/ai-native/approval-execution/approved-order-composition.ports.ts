import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiExecutionContext, AiProposalActionDraft, AiProposalSnapshotRefDraft, CreateRentalOrderRequest, RentalQuoteSnapshotV1 } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { RentalOrderConfirmationService } from '../../rental-core/rental-order-confirmation.service';
import type { RentalBusinessFactStore } from '../../rental-core/rental-business-fact.repository';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { AiApprovedOrderInput } from './approved-order.ports';

export interface ApprovedOrderCommand {
  taskId: string;
  proposalId: string;
  proposalRevision: number;
  reviewedPayloadHash: string;
  approvalId: string;
  actionId: string;
  lease: AiApprovedOrderInput['lease'];
}

export type ApprovedOrderPolicyRequest = Omit<ApprovedOrderCommand, 'lease'>;
export interface ApprovedOrderPolicyAuthority {
  resolve(request: ApprovedOrderPolicyRequest, operation: 'read', tx?: Prisma.TransactionClient): Promise<AiExecutionContext>;
  resolve(request: ApprovedOrderPolicyRequest & { action: AiProposalActionDraft }, operation: 'execute' | 'replay', tx?: Prisma.TransactionClient): Promise<AiExecutionContext>;
}

export interface ApprovedOrderSnapshot<T> extends AiProposalSnapshotRefDraft {
  scopeId: string;
  taskId: string;
  actionId: string;
  payload: T;
}

export interface ApprovedOrderSnapshotSource {
  read(request: {
    context: AiExecutionContext; scopeId: string; taskId: string; proposalId: string; proposalRevision: number;
    action: AiProposalActionDraft;
  }, tx?: Prisma.TransactionClient): Promise<{
    input: ApprovedOrderSnapshot<CreateRentalOrderRequest>;
    preview: ApprovedOrderSnapshot<RentalQuoteSnapshotV1>;
  }>;
}

export type ApprovedOrderDb = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiProposal' | 'aiProposalVersion' | 'aiProposalAction' | 'aiApproval' | 'aiApprovalConsumption'>;
export interface ApprovedOrderCompositionDependencies {
  db: ApprovedOrderDb;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  policy: ApprovedOrderPolicyAuthority;
  snapshots: ApprovedOrderSnapshotSource;
  confirmation: Pick<RentalOrderConfirmationService, 'createApprovedOrder'>;
  core: Pick<RentalCoreService, 'resolveWorkspaceId' | 'getProfile' | 'getWorkspaceCategory' | 'getBusinessSettings' | 'listItemGroups' | 'listPricingGroups' | 'listCouponTemplates' | 'listLocations' | 'listOperators' | 'getOrder'>;
  quoteFacts: Pick<RentalBusinessFactStore, 'findQuote'>;
  toolVersion: string;
  clock?: () => Date;
}
