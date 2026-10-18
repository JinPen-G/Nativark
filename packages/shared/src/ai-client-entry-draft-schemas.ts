import { z } from 'zod';
import { AI_CUSTOMER_ENTRY_SURFACES } from './ai-entry-action-draft';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT } from './ai-task-draft';
import { AI_BOOKING_ACCEPTANCE_READ_VERSION } from './ai-booking-draft';
import { AI_TASK_INPUT_DRAFT_VERSION, isAiTaskInputContractDraft, isAiTaskInputSubmissionDraft,
  type AiTaskInputContractDraft, type AiTaskInputSubmissionDraft } from './ai-task-input-draft';

export const AI_CLIENT_HOST_CAPABILITIES_VERSION = 'ain-client-host-capabilities-2' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
/** Reads bind the original creation/material reference; no caller task, owner or scope. */
export const aiClientTaskReadRequestSchema = z.object({ creationKey: id.max(128), materialRef: z.string().uuid() }).strict();
export const AI_CLIENT_MATERIAL_RECEIPT_VERSION = 'ain-client-material-receipt-1' as const;
export const aiClientOrderMaterialRequestSchema = z.object({ operationKey: id.max(128), orderId: id }).strict();
export const aiClientOrderMaterialReceiptSchema = z.object({ contractVersion: z.literal(AI_CLIENT_MATERIAL_RECEIPT_VERSION),
  operationKey: id.max(128), state: z.enum(['observed', 'unknown']), materialRef: z.string().uuid().nullable(),
  materialHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), expiresAt: z.string().datetime({ offset: true }).nullable(),
  execution: z.literal('not_attested'), freshness: z.literal('revalidate_before_execution'),
  retryable: z.literal(false), nextAction: z.literal('read_original_material_receipt') }).strict()
  .refine(value => value.state === 'observed' ? value.materialRef !== null && value.materialHash !== null && value.expiresAt !== null
    : value.materialRef === null && value.materialHash === null && value.expiresAt === null);
export const aiClientTaskCreationReceiptSchema = z.object({ contractVersion: z.literal(AI_TASK_DRAFT_VERSION),
  creationKey: id.max(128), materialRef: z.string().uuid(), state: z.enum(['observed', 'unknown']),
  inputRef: z.string().uuid().nullable(), inputHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  task: z.object({ taskId: id.max(36), runId: id.max(36), status: z.enum(AI_TASK_STATUSES_DRAFT),
    revision: z.number().int().min(1).max(4294967294), replayed: z.boolean() }).strict().nullable(),
  execution: z.literal('not_attested'), retryable: z.literal(false), nextAction: z.literal('read_original_task_creation') }).strict()
  .refine(value => value.state === 'observed' ? value.task !== null && value.inputRef !== null && value.inputHash !== null : value.task === null);
/** Cancellation is a distinct current-policy action, never execution authority. */
export const aiClientTaskCancelRequestSchema = aiClientTaskReadRequestSchema.extend({
  expectedRevision: z.number().int().min(1).max(4294967294)
}).strict();
/** Original call selector, not customer-supplied usage, price or authority. */
export const aiClientTaskAccountingRequestSchema = aiClientTaskReadRequestSchema.extend({ callId: id.max(128) }).strict();
export const aiClientTaskAccountingResponseSchema = z.object({ contractVersion: z.literal(AI_TASK_DRAFT_VERSION),
  callId: id.max(128), state: z.enum(['observed', 'unknown']),
  account: z.object({ status: z.enum(['reserved', 'settled', 'released', 'pending_reconciliation']),
    usageRecorded: z.boolean(), dispatched: z.boolean() }).strict().nullable(),
  meaning: z.literal('ai_invocation_not_business_payment'),
  observedAt: z.string().datetime({ offset: true }), execution: z.literal('not_authorized_by_accounting'),
  retryable: z.literal(false), nextAction: z.literal('read_original_accounting') }).strict()
  .refine(value => (value.state === 'observed') === (value.account !== null))
  .refine(value => !value.account || (value.account.status === 'settled') === value.account.usageRecorded);
export const aiClientTaskCancelReceiptSchema = z.object({
  contractVersion: z.literal(AI_TASK_DRAFT_VERSION), taskId: id.max(36),
  taskRevision: z.number().int().min(1).max(4294967295),
  cursor: z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => value.length < 20 || value <= '18446744073709551615'),
  observedAt: z.string().datetime({ offset: true }),
  status: z.literal('cancel_requested'), cancellation: z.literal('requested_not_rollback'),
  retryable: z.literal(false), nextAction: z.literal('read_original_task')
}).strict();
export type AiClientTaskCancelRequest = z.infer<typeof aiClientTaskCancelRequestSchema>;
export type AiClientTaskCancelReceipt = z.infer<typeof aiClientTaskCancelReceiptSchema>;
/** Only the original released-input witness can produce this observation. */
export const aiClientTaskInputCancellationReceiptSchema = aiClientTaskCancelReceiptSchema.extend({
  status: z.literal('cancelled'), cancellation: z.literal('released_input_wait_settled'),
  externalRollback: z.literal('not_claimed')
}).strict();
export type AiClientTaskInputCancellationReceipt = z.infer<typeof aiClientTaskInputCancellationReceiptSchema>;
/** The original input contract remains authoritative; no parallel field DSL. */
export const aiClientTaskInputReadResponseSchema = z.discriminatedUnion('state', [
  z.object({ contractVersion: z.literal(AI_TASK_INPUT_DRAFT_VERSION), state: z.literal('pending'),
    question: z.object({ requestId: id.max(36), revision: z.number().int().min(1).max(4294967294),
      expiresAt: z.string().datetime({ offset: true }),
      contract: z.custom<AiTaskInputContractDraft>(isAiTaskInputContractDraft) }).strict(),
    execution: z.literal('not_authorized_by_observation') }).strict(),
  z.object({ contractVersion: z.literal(AI_TASK_INPUT_DRAFT_VERSION), state: z.literal('not_pending'),
    question: z.null(), execution: z.literal('not_authorized_by_observation') }).strict()
]);
export type AiClientTaskInputReadResponse = z.infer<typeof aiClientTaskInputReadResponseSchema>;
/** Model execution observation is never a Core/approval result. */
export const aiClientTaskModelControlResponseSchema = z.object({
  contractVersion: z.literal(AI_TASK_DRAFT_VERSION),
  execution: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('not_started'), reason: z.enum(['host_aborted', 'plan_unavailable',
      'task_not_runnable', 'lease_held', 'recovery_lease_unavailable']) }).strict(),
    z.object({ kind: z.literal('run_outcome'), outcome: z.object({
      status: z.enum(['succeeded', 'partially_succeeded', 'paused', 'cancel_requested', 'cancelled', 'unknown', 'unavailable', 'failed']),
      completedSteps: z.number().int().min(0).max(4294967295),
      cleanupFailed: z.number().int().min(0).max(4294967295)
    }).strict() }).strict()
  ]), businessExecution: z.literal('not_inferred_from_model_result'),
  retryable: z.literal(false), nextAction: z.literal('read_original_task')
}).strict();
export const aiClientTaskModelResultReadResponseSchema = z.object({
  contractVersion: z.literal(AI_TASK_DRAFT_VERSION), taskId: id.max(36),
  taskRevision: z.number().int().min(1).max(4294967295),
  state: z.enum(['observed', 'not_observed']),
  result: z.object({ resultId: id.max(36), status: z.enum(['succeeded', 'failed', 'unknown']),
    observedAt: z.string().datetime({ offset: true }), text: z.string().max(32768).nullable() }).strict().nullable(),
  authority: z.literal('generated_text_not_business_fact'), businessExecution: z.literal('not_inferred_from_model_result'),
  retryable: z.literal(false), nextAction: z.literal('read_original_task')
}).strict().superRefine((value, context) => {
  if ((value.state === 'observed') !== (value.result !== null)
    || (value.result && (value.result.status === 'succeeded') !== (value.result.text !== null)))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent model result observation' });
});
export const aiClientTaskInputSubmissionRequestSchema = aiClientTaskReadRequestSchema.extend({
  submission: z.custom<Omit<AiTaskInputSubmissionDraft, 'taskId'>>(value => !!value && typeof value === 'object'
    && !Array.isArray(value) && !Object.prototype.hasOwnProperty.call(value, 'taskId')
    && isAiTaskInputSubmissionDraft({ ...value, taskId: 'validation-only' }))
}).strict();
const clientInputReceipt = z.object({ taskId: id.max(36), requestId: id.max(36), receiptId: id.max(36),
  taskRevision: z.number().int().min(1).max(4294967295) }).strict();
export const aiClientTaskInputSubmissionReceiptSchema = clientInputReceipt.extend({
  contractVersion: z.literal(AI_TASK_INPUT_DRAFT_VERSION), status: z.literal('input_received'), replayed: z.boolean(),
  execution: z.literal('not_inferred_from_receipt') }).strict();
export const aiClientTaskInputReceiptReadResponseSchema = z.discriminatedUnion('state', [
  z.object({ contractVersion: z.literal(AI_TASK_INPUT_DRAFT_VERSION), state: z.literal('observed'),
    receipt: clientInputReceipt, execution: z.literal('not_inferred_from_receipt') }).strict(),
  z.object({ contractVersion: z.literal(AI_TASK_INPUT_DRAFT_VERSION), state: z.literal('not_observed'),
    receipt: z.null(), execution: z.literal('not_inferred_from_receipt') }).strict()
]);
export const aiClientTaskEventsReadRequestSchema = aiClientTaskReadRequestSchema.extend({
  after: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u), limit: z.number().int().min(1).max(100)
}).strict();
export const aiClientOrderExplanationReadRequestSchema = z.object({ orderId: id,
  question: z.enum(['status', 'fees']).default('status') }).strict();
export const aiClientSourceReadRequestSchema = z.object({ materialRef: z.string().uuid() }).strict();
export const aiBookingAcceptanceReadRequestSchema = z.object({ handoffRef: z.string().uuid(), contactPhone: z.string().max(32).optional() }).strict();
const bookingAcceptance = z.object({ acceptanceRef: z.string().uuid(), handoffRef: z.string().uuid(),
  bookingDraftId: z.string().uuid(), selectionRevision: z.number().int().min(1).max(4294967294),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), quoteId: id, operationKey: id,
  execution: z.literal('not_attested') }).strict();
const acceptanceObservation = { contractVersion: z.literal(AI_BOOKING_ACCEPTANCE_READ_VERSION), handoffRef: z.string().uuid(),
  operationKey: id, currentUse: z.literal('not_authorized_by_receipt'), execution: z.literal('not_attested'), retryable: z.literal(false) };
export const aiBookingAcceptanceReadResponseSchema = z.discriminatedUnion('state', [
  z.object({ ...acceptanceObservation, state: z.literal('observed'), acceptance: bookingAcceptance,
    nextAction: z.literal('read_original_submission') }).strict(),
  z.object({ ...acceptanceObservation, state: z.literal('unknown'), acceptance: z.null(),
    nextAction: z.literal('read_original_acceptance') }).strict()
]).superRefine((value, context) => {
  if (value.acceptance && (value.acceptance.handoffRef !== value.handoffRef || value.acceptance.operationKey !== value.operationKey)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent acceptance observation' });
  }
});
export const aiClientHostCapabilitiesRequestSchema = z.object({}).strict();
export const aiClientHostCapabilitiesSchema = z.object({
  contractVersion: z.literal(AI_CLIENT_HOST_CAPABILITIES_VERSION),
  enabled: z.boolean(), audience: z.literal('customer'), surface: z.enum(AI_CUSTOMER_ENTRY_SURFACES),
  channel: z.enum(['wechat_miniprogram', 'web']),
  customerId: id, customerType: z.enum(['personal', 'corporate']), tenantCode: id, serviceCode: id,
  scope: z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict(),
  policy: z.object({ revision: z.number().int().min(1).max(4294967294), allowRead: z.literal(true), allowCreate: z.boolean() }).strict(),
  releaseRevision: id, observedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
  capabilities: z.object({
    entryActions: z.array(z.enum(['OPEN_ORDER', 'CREATE_BOOKING_DRAFT', 'OPEN_BOOKING'])).max(3),
    bookingDrafts: z.boolean(), savedDeliveryAddresses: z.boolean(), bookingReceiptRead: z.boolean()
  }).strict(),
  authorization: z.literal('observation_only_recheck_each_action')
}).strict().superRefine((value, context) => {
  const actions = value.capabilities.entryActions;
  if (value.surface !== (value.channel === 'web' ? 'tenant_website' : 'client_miniprogram')
    || Date.parse(value.expiresAt) <= Date.parse(value.observedAt)
    || new Set(actions).size !== actions.length
    || value.enabled !== (actions.length > 0 || value.capabilities.bookingReceiptRead)
    || (!value.policy.allowCreate && (actions.length > 0 || value.capabilities.bookingDrafts || value.capabilities.savedDeliveryAddresses))
    || value.capabilities.bookingDrafts !== (actions.includes('CREATE_BOOKING_DRAFT') && actions.includes('OPEN_BOOKING'))
    || (value.capabilities.savedDeliveryAddresses && !value.capabilities.bookingDrafts)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent client host capabilities' });
  }
});
export type AiClientHostCapabilities = z.infer<typeof aiClientHostCapabilitiesSchema>;
