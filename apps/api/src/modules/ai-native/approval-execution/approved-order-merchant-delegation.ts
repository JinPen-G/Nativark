/** Immutable AI comparison data from the original private enterprise source.
 * Core alone seals delegation authority and consumes the original D/approval.
 * Reading or saving this projection grants neither approval nor execution. */
import { z } from 'zod';
import type { AiQuoteSelectedOrderDraft, CreateRentalOrderRequest, EnterpriseOrderDelegationReference } from '@rental-os/shared';
import { getRequestIdentity } from '../../../common/request-identity';
import type { EnterpriseMerchantDelegationService, EnterpriseMerchantDelegationActorAuth } from '../../enterprise/enterprise-merchant-delegation.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { ApprovedOrderMerchantDelegationSnapshot } from './approved-order-composition.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9._:-]+$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const approvedOrderMerchantDelegationReferenceSchema = z.object({
  delegationKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u),
  expectedRevision: z.literal(1), approvalId: id.optional()
}).strict();
export const approvedOrderMerchantDelegationSnapshotSchema = z.object({
  version: z.literal('enterprise-order-delegation-1'), purpose: z.literal('merchant_operator'),
  reference: approvedOrderMerchantDelegationReferenceSchema,
  sourceHash: hash, basisHash: hash, requestHash: hash, quoteHash: hash, quoteId: id,
  personalCustomerId: id, corporateCustomerId: id, expiresAt: z.string().datetime({ offset: true })
}).strict();
export type ApprovedOrderMerchantDelegationSource = Pick<EnterpriseMerchantDelegationService,
  'readMerchantDelegatedSubmission' | 'prepareMerchantDelegatedSubmission' | 'merchantDelegationParticipant'>;

/** Keep the public command limited to the explicitly reviewed rental fields.
 * Additional original order fields are resolved and retained on the server. */
export function approvedOrderSelectionInput(body: CreateRentalOrderRequest): AiQuoteSelectedOrderDraft {
  const bookingIdentity = body.bookingIdentity?.bookingIdentity === 'enterprise_employee'
    ? { bookingIdentity: 'enterprise_employee' as const, corporateCustomerId: body.bookingIdentity.corporateCustomerId,
      enterpriseContractAndPayer: body.bookingIdentity.enterpriseContractAndPayer }
    : body.bookingIdentity ? { bookingIdentity: 'personal' as const } : undefined;
  return structuredClone({ quoteId: body.quoteId, customerType: body.customerType, customerId: body.customerId,
    customerName: body.customerName, ...(body.contactPhone ? { contactPhone: body.contactPhone } : {}),
    ...(bookingIdentity ? { bookingIdentity } : {}), fulfillmentMode: body.fulfillmentMode,
    fulfillmentLocationId: body.fulfillmentLocationId, ...(body.returnLocationId ? { returnLocationId: body.returnLocationId } : {}),
    startAt: body.startAt, endAt: body.endAt, lines: body.lines }) as AiQuoteSelectedOrderDraft;
}

export async function readOriginalMerchantDelegationSubmission(source: ApprovedOrderMerchantDelegationSource | undefined,
  actor: EnterpriseMerchantDelegationActorAuth, reference: EnterpriseOrderDelegationReference, operation: 'prepare' | 'read') {
  if (!source || typeof source.readMerchantDelegatedSubmission !== 'function'
    || typeof source.prepareMerchantDelegatedSubmission !== 'function' || typeof source.merchantDelegationParticipant !== 'function') {
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  const ref = approvedOrderMerchantDelegationReferenceSchema.parse(structuredClone(reference));
  const identity = getRequestIdentity();
  if (!identity || identity.audience !== 'operator' || identity.isSaasAdmin || identity.staffApi
    || identity.userId !== actor.user.id || identity.tenantId !== actor.user.tenantId) {
    throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
  const row = operation === 'prepare' ? await source.prepareMerchantDelegatedSubmission(actor, ref)
    : await source.readMerchantDelegatedSubmission(actor, ref);
  if (row.tenantId !== identity.tenantId || row.workspaceId !== identity.workspaceId
    || row.delegationKey !== ref.delegationKey || row.coreIdempotencyKey !== ref.delegationKey
    || ref.approvalId !== undefined && row.approvalId !== ref.approvalId) {
    throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  }
  return structuredClone(row);
}

export async function readApprovedOrderMerchantDelegation(source: ApprovedOrderMerchantDelegationSource | undefined,
  actor: EnterpriseMerchantDelegationActorAuth, reference: EnterpriseOrderDelegationReference,
  body: CreateRentalOrderRequest, quoteHash: string, operation: 'prepare' | 'read'): Promise<ApprovedOrderMerchantDelegationSnapshot> {
  const ref = approvedOrderMerchantDelegationReferenceSchema.parse(structuredClone(reference));
  const row = await readOriginalMerchantDelegationSubmission(source, actor, ref, operation);
  if (row.quoteId !== body.quoteId || row.personalCustomerId !== body.customerId || body.customerType !== 'personal'
    || body.bookingIdentity?.bookingIdentity !== 'enterprise_employee'
    || body.bookingIdentity.corporateCustomerId !== row.corporateCustomerId
    || row.requestHash !== requestFingerprint(body) || requestFingerprint(row.request) !== requestFingerprint(body)) {
    throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  }
  return approvedOrderMerchantDelegationSnapshotSchema.parse({ version: row.version, purpose: row.purpose,
    reference: { delegationKey: ref.delegationKey, expectedRevision: 1, ...(row.approvalId ? { approvalId: row.approvalId } : {}) },
    sourceHash: row.sourceHash, basisHash: row.basisHash, requestHash: row.requestHash, quoteHash,
    quoteId: row.quoteId, personalCustomerId: row.personalCustomerId, corporateCustomerId: row.corporateCustomerId,
    expiresAt: row.expiresAt });
}
