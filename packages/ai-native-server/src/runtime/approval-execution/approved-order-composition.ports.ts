import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiExecutionContext, AiProposalActionDraft, AiProposalSnapshotRefDraft, CreateRentalOrderRequest, EnterpriseOrderDelegationReference, RentalQuoteSnapshotV1 } from '@rental-os/shared';
import type { ApiAuthGuard } from '../rental-adapters/api-auth.guard';
import type { RentalCoreService } from '../rental-adapters/rental-core.service';
import type { RentalOrderConfirmationService } from '../rental-adapters/rental-order-confirmation.service';
import type { RentalBusinessFactStore } from '../rental-adapters/rental-business-fact.repository';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { AiApprovedOrderInput } from './approved-order.ports';
import type { PersistedApprovedOrderPolicyDependencies } from './persisted-approved-order-policy.authority';
import type { ApprovedOrderMerchantDelegationSource } from './approved-order-merchant-delegation';

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

/** Immutable comparison data from the original private D reader. Core mints
 * its own opaque authority when it executes the same request and D key. */
export interface ApprovedOrderMerchantDelegationSnapshot {
  version: 'enterprise-order-delegation-1';
  purpose: 'merchant_operator';
  reference: Omit<EnterpriseOrderDelegationReference, 'expectedRevision'> & { expectedRevision: 1 };
  sourceHash: string;
  basisHash: string;
  requestHash: string;
  quoteHash: string;
  quoteId: string;
  personalCustomerId: string;
  corporateCustomerId: string;
  expiresAt: string;
}

export type ApprovedOrderPreview = Pick<RentalQuoteSnapshotV1, 'id' | 'tenantId' | 'pricingPlanVersion' | 'expiresAt' | 'consumedAt' | 'consumedOrderId'>
  & { merchantDelegation?: ApprovedOrderMerchantDelegationSnapshot };

export interface ApprovedOrderSnapshotSource {
  read(request: {
    context: AiExecutionContext; scopeId: string; taskId: string; proposalId: string; proposalRevision: number;
    action: AiProposalActionDraft;
  }, tx?: Prisma.TransactionClient): Promise<{
    input: ApprovedOrderSnapshot<CreateRentalOrderRequest>;
    preview: ApprovedOrderSnapshot<ApprovedOrderPreview>;
  }>;
}

export interface ApprovedOrderOriginalInputSource {
  read(reference: { context: AiExecutionContext; scopeId: string; taskId: string; actionId: string; runId: string },
    tx: Prisma.TransactionClient): Promise<CreateRentalOrderRequest | null>;
  readDelegation?(reference: Parameters<ApprovedOrderOriginalInputSource['read']>[0],
    tx: Prisma.TransactionClient): Promise<ApprovedOrderMerchantDelegationSnapshot | null>;
}

export interface ApprovedOrderExecutionInputSource extends ApprovedOrderOriginalInputSource {
  readAuthorized(reference: Parameters<ApprovedOrderOriginalInputSource['read']>[0], tx: Prisma.TransactionClient): Promise<{
    body: CreateRentalOrderRequest;
    bindingHash: string;
    merchantDelegation?: ApprovedOrderMerchantDelegationSnapshot;
  }>;
}

export interface PersistedApprovedOrderDependencies extends Omit<ApprovedOrderCompositionDependencies, 'db' | 'policy' | 'snapshots'>,
  PersistedApprovedOrderPolicyDependencies {
  inputSource: ApprovedOrderOriginalInputSource;
  confirmation: Pick<RentalOrderConfirmationService, 'createApprovedOrder' | 'assertOrderMatchesQuote'>
    & Partial<Pick<RentalOrderConfirmationService, 'fingerprintOrderRequest' | 'readOrderCreation'>>;
}

export type ApprovedOrderDb = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiProposal' | 'aiProposalVersion' | 'aiProposalAction' | 'aiApproval' | 'aiApprovalConsumption'>;
export interface ApprovedOrderCompositionDependencies {
  db: ApprovedOrderDb;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  policy: ApprovedOrderPolicyAuthority;
  snapshots: ApprovedOrderSnapshotSource;
  // Generic low-level compositions may supply their own source. The controlled
  // persisted entry point always injects the formal input/closed-plan proof.
  executionInput?: ApprovedOrderExecutionInputSource;
  confirmation: Pick<RentalOrderConfirmationService, 'createApprovedOrder'>
    & Partial<Pick<RentalOrderConfirmationService, 'fingerprintOrderRequest' | 'readOrderCreation'>>;
  merchantDelegations?: ApprovedOrderMerchantDelegationSource;
  core: Pick<RentalCoreService, 'resolveWorkspaceId' | 'readBusinessContext' | 'getProfile' | 'getWorkspaceCategory' | 'getBusinessSettings' | 'listItemGroups' | 'listPricingGroups' | 'listCouponTemplates' | 'listLocations' | 'listOperators' | 'getOrder'>
    & Partial<Pick<RentalCoreService, 'listItemGroupsPage' | 'readQuoteConfiguration' | 'resolvePricingGroupQuoteRequest'>>;
  quoteFacts: Pick<RentalBusinessFactStore, 'findQuote'>;
  toolVersion: string;
  clock?: () => Date;
}
