/** Private server metadata for one original Booking handoff. No public DTO,
 * credential, customer body, new Draft state or execution grant is defined here.
 * Principals and original proofs must come from the request-bound Auth/Core
 * ports below; references, hashes and stored receipts never authorize a caller. */
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { entryDate, entryHash, entryId } from './client-entry-action';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';

export const CLIENT_BOOKING_TRANSFER_LIFETIME_MS = 60000;
const channel = z.enum(['web', 'wechat_miniprogram']);
const revision = z.number().int().min(1).max(4294967294);
const reference = z.string().uuid();

/** Ephemeral metadata returned by current, independent Client Auth. Names,
 * phone/address text and bearer credentials must stay in the owning host. */
export const clientBookingTransferPrincipalSchema = z.object({
  tenantId: entryId, workspaceId: entryId, customerId: entryId, customerType: z.literal('personal'),
  channel, appId: entryId.nullable(), sessionId: entryId,
  principalHash: entryHash, bindingHash: entryHash, publicationHash: entryHash,
  policyHash: entryHash.nullable(), authorizedAt: entryDate, expiresAt: entryDate
}).strict();
export type ClientBookingTransferPrincipal = z.infer<typeof clientBookingTransferPrincipalSchema>;

export const clientBookingTransferCustomerHash = (principal: Pick<ClientBookingTransferPrincipal, 'tenantId' | 'customerId' | 'customerType'>) =>
  requestFingerprint({ version: 'client-booking-transfer-customer-1', tenantId: principal.tenantId,
    customerId: principal.customerId, customerType: principal.customerType });
/** Matches the original request-bound Booking material scope, including appId
 * and the actual session. A cross-channel customerHash is never a substitute. */
export const clientBookingTransferPrincipalHash = (principal: Pick<ClientBookingTransferPrincipal,
  'tenantId' | 'workspaceId' | 'channel' | 'appId' | 'customerId' | 'customerType' | 'sessionId'>) =>
  requestFingerprint({ tenantId: principal.tenantId, workspaceId: principal.workspaceId, channel: principal.channel,
    appId: principal.appId, customerId: principal.customerId, customerType: principal.customerType, sessionId: principal.sessionId });

/** Only stable scope/session hashes and current publication/policy witnesses
 * are retained. customerHash compares the same customer across two channels. */
export const clientBookingTransferBindingSchema = z.object({
  tenantId: entryId, workspaceId: entryId, channel, appId: entryId.nullable(), principalKind: z.literal('personal'),
  customerHash: entryHash, principalHash: entryHash, bindingHash: entryHash,
  publicationHash: entryHash, policyHash: entryHash, authorizedUntil: entryDate
}).strict();
export type ClientBookingTransferBinding = z.infer<typeof clientBookingTransferBindingSchema>;
export const clientBookingTransferScopeSchema = clientBookingTransferBindingSchema.pick({
  tenantId: true, workspaceId: true, channel: true, principalKind: true, principalHash: true
});
export type ClientBookingTransferScope = z.infer<typeof clientBookingTransferScopeSchema>;

export const clientBookingTransferOriginalSchema = z.object({
  draftId: reference, draftRevision: revision, selectionRevision: z.literal(1), selectedAt: entryDate,
  materialRef: reference, materialOperationKey: entryId, inputHash: entryHash, materialHash: entryHash,
  materialExpiresAt: entryDate, draftExpiresAt: entryDate,
  handoffRef: reference, handoffCreatedAt: entryDate, handoffExpiresAt: entryDate, bookingOperationKey: entryId
}).strict();
export type ClientBookingTransferOriginal = z.infer<typeof clientBookingTransferOriginalSchema>;
/** This is the EXISTING original-page acceptance/Core idempotency key. Target
 * channels must retain it, never derive another key from their own scope. */
export const clientBookingTransferOriginalOperationKey = (scope: ClientBookingTransferScope, handoffRef: string) =>
  `booking-order:${requestFingerprint({ scope: clientBookingTransferScopeSchema.parse({ tenantId: scope.tenantId,
    workspaceId: scope.workspaceId, channel: scope.channel, principalKind: scope.principalKind, principalHash: scope.principalHash }),
    handoffRef: reference.parse(handoffRef) })}`;

export const clientBookingTransferIssueCommandSchema = z.object({
  handoffRef: reference, targetChannel: channel, operationKey: entryId
}).strict();
export type ClientBookingTransferIssueCommand = z.infer<typeof clientBookingTransferIssueCommandSchema>;
export const clientBookingTransferConsumeCommandSchema = z.object({ transferRef: reference, operationKey: entryId }).strict();
export type ClientBookingTransferConsumeCommand = z.infer<typeof clientBookingTransferConsumeCommandSchema>;

export const clientBookingTransferIssueReceiptSchema = z.object({
  version: z.literal('client-booking-transfer-issued-1'), transferRef: reference,
  operationKey: entryId, requestHash: entryHash, source: clientBookingTransferBindingSchema,
  original: clientBookingTransferOriginalSchema, targetChannel: channel, targetPolicyHash: entryHash,
  issuedAt: entryDate, expiresAt: entryDate
}).strict().superRefine((value, context) => {
  const start = Date.parse(value.issuedAt), end = Date.parse(value.expiresAt);
  if (value.source.channel === value.targetChannel || end <= start || end - start > CLIENT_BOOKING_TRANSFER_LIFETIME_MS
    || end > Math.min(Date.parse(value.source.authorizedUntil), Date.parse(value.original.materialExpiresAt),
      Date.parse(value.original.draftExpiresAt), Date.parse(value.original.handoffExpiresAt))
    || Date.parse(value.original.selectedAt) > Date.parse(value.original.handoffCreatedAt)
    || Date.parse(value.original.handoffCreatedAt) > start
    || Date.parse(value.original.handoffExpiresAt) <= Date.parse(value.original.handoffCreatedAt)
    || Date.parse(value.original.handoffExpiresAt) - Date.parse(value.original.handoffCreatedAt) > CLIENT_BOOKING_TRANSFER_LIFETIME_MS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Original handoff and bounded transfer lifetime required' });
  }
});
export type ClientBookingTransferIssueReceipt = z.infer<typeof clientBookingTransferIssueReceiptSchema>;

export const clientBookingTransferConsumeReceiptSchema = z.object({
  version: z.literal('client-booking-transfer-consumed-1'), transferRef: reference, operationKey: entryId,
  issueHash: entryHash, requestHash: entryHash, target: clientBookingTransferBindingSchema,
  consumedAt: entryDate, expiresAt: entryDate
}).strict().superRefine((value, context) => {
  const start = Date.parse(value.consumedAt), end = Date.parse(value.expiresAt);
  if (end <= start || end - start > CLIENT_BOOKING_TRANSFER_LIFETIME_MS || end > Date.parse(value.target.authorizedUntil)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Bounded current target lifetime required' });
  }
});
export type ClientBookingTransferConsumeReceipt = z.infer<typeof clientBookingTransferConsumeReceiptSchema>;

/** Existing OperationLog unique IDs hold these pointers; the full metadata
 * receipt is stored once. There is no separate transfer database or journal. */
export const clientBookingTransferIndexSchema = z.object({
  version: z.literal('client-booking-transfer-index-1'),
  kind: z.enum(['reference', 'issue_operation', 'consume_operation']), transferRef: reference, draftId: reference, receiptHash: entryHash
}).strict();
export type ClientBookingTransferIndex = z.infer<typeof clientBookingTransferIndexSchema>;

export const clientBookingTransferTargetLookupSchema = z.union([
  z.object({ handoffRef: reference }).strict(), z.object({ draftId: reference }).strict(),
  z.object({ acceptanceRef: reference }).strict()
]);
export type ClientBookingTransferTargetLookup = z.infer<typeof clientBookingTransferTargetLookupSchema>;
/** A locator names only a consumed receipt. Its target principal/binding and
 * the original receipt are always rechecked; this is no authorization cache. */
export const clientBookingTransferTargetLocatorSchema = z.object({
  version: z.literal('client-booking-transfer-target-locator-1'), kind: z.enum(['handoff', 'draft', 'acceptance']),
  locatorRef: reference, transferRef: reference, draftId: reference, receiptHash: entryHash,
  targetPrincipalHash: entryHash, targetBindingHash: entryHash
}).strict();
export type ClientBookingTransferTargetLocator = z.infer<typeof clientBookingTransferTargetLocatorSchema>;

/** Returned ONLY after the host rechecks original quote/material/selection,
 * customer ownership, both applicable publications and current policy. The
 * repository compares every witness to locked original metadata before writing. */
export const clientBookingTransferOriginalProofSchema = z.object({
  draftId: reference, draftRevision: revision, handoffRef: reference, materialRef: reference,
  inputHash: entryHash, materialHash: entryHash, selectionRevision: z.literal(1), customerHash: entryHash,
  sourceBindingHash: entryHash, sourcePublicationHash: entryHash, sourcePolicyHash: entryHash, targetPolicyHash: entryHash,
  authorizedUntil: entryDate
}).strict();
export type ClientBookingTransferOriginalProof = z.infer<typeof clientBookingTransferOriginalProofSchema>;

export type ClientBookingTransferTransaction = Pick<Prisma.TransactionClient, '$queryRaw' | 'operationLog'>;
export type ClientBookingTransferDatabase = Pick<PrismaClient, '$transaction' | '$queryRaw' | 'operationLog'>;
export interface ClientBookingTransferAuthority {
  /** Same source caller's actual current Auth; read is independent of new
   * execution/TTL and must still enforce current receipt access. */
  source(handoffRef: string, purpose: 'read' | 'issue', transaction: ClientBookingTransferTransaction): Promise<ClientBookingTransferPrincipal>;
  /** Current target Auth is resolved before looking up a transfer. The ref is
   * only a locator and cannot supply tenant/customer/session or permissions. */
  target(transferRef: string, purpose: 'read' | 'consume', transaction: ClientBookingTransferTransaction): Promise<ClientBookingTransferPrincipal>;
  /** Use the same transaction for original metadata; use actual current Auth
   * and Core/read ports for permission and business witnesses. Do not nest an
   * original writer, decrypt with target bindings, or substitute a true check.
   * At issue, targetPolicyHash comes from the selected target channel's current
   * server publication/policy. At consume it must match current target Auth. */
  original(source: ClientBookingTransferBinding, original: ClientBookingTransferOriginal,
    viewer: ClientBookingTransferPrincipal, purpose: 'issue' | 'consume',
    transaction: ClientBookingTransferTransaction): Promise<ClientBookingTransferOriginalProof>;
}

export const clientBookingTransferReceiptSchema = z.object({
  issue: clientBookingTransferIssueReceiptSchema, consumption: clientBookingTransferConsumeReceiptSchema.nullable(),
  currentUse: z.literal('not_authorized_by_receipt')
}).strict();
export type ClientBookingTransferReceipt = z.infer<typeof clientBookingTransferReceiptSchema>;

export type ClientBookingTransferSourceInterlock =
  | { state: 'not_issued'; currentUse: 'not_authorized_by_receipt' }
  | { state: 'pending'; issue: ClientBookingTransferIssueReceipt; currentUse: 'not_authorized_by_receipt' }
  | { state: 'consumed'; issue: ClientBookingTransferIssueReceipt; consumption: ClientBookingTransferConsumeReceipt;
      currentUse: 'not_authorized_by_receipt' };
