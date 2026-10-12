import { z } from 'zod';
import { AI_CUSTOMER_ENTRY_SURFACES } from './ai-entry-action-draft';
import { AI_TASK_DRAFT_VERSION } from './ai-task-draft';
import { AI_TASK_INPUT_DRAFT_VERSION, isAiTaskInputContractDraft, type AiTaskInputContractDraft } from './ai-task-input-draft';

export const AI_CLIENT_HOST_CAPABILITIES_VERSION = 'ain-client-host-capabilities-1' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
/** Reads bind the original creation/material reference; no caller task, owner or scope. */
export const aiClientTaskReadRequestSchema = z.object({ creationKey: id.max(128), materialRef: z.string().uuid() }).strict();
/** Cancellation is a distinct current-policy action, never execution authority. */
export const aiClientTaskCancelRequestSchema = aiClientTaskReadRequestSchema.extend({
  expectedRevision: z.number().int().min(1).max(4294967294)
}).strict();
export const aiClientTaskCancelReceiptSchema = z.object({
  contractVersion: z.literal(AI_TASK_DRAFT_VERSION), taskId: id.max(36),
  taskRevision: z.number().int().min(1).max(4294967295),
  cursor: z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => BigInt(value) <= 18446744073709551615n),
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
export const aiClientTaskEventsReadRequestSchema = aiClientTaskReadRequestSchema.extend({
  after: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u), limit: z.number().int().min(1).max(100)
}).strict();
export const aiClientOrderExplanationReadRequestSchema = z.object({ orderId: id,
  question: z.enum(['status', 'fees']).default('status') }).strict();
export const aiClientSourceReadRequestSchema = z.object({ materialRef: z.string().uuid() }).strict();
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
    bookingDrafts: z.boolean(), savedDeliveryAddresses: z.boolean()
  }).strict(),
  authorization: z.literal('observation_only_recheck_each_action')
}).strict().superRefine((value, context) => {
  const actions = value.capabilities.entryActions;
  if (value.surface !== (value.channel === 'web' ? 'tenant_website' : 'client_miniprogram')
    || Date.parse(value.expiresAt) <= Date.parse(value.observedAt)
    || new Set(actions).size !== actions.length
    || value.enabled !== (actions.length > 0)
    || (!value.policy.allowCreate && (value.enabled || value.capabilities.bookingDrafts || value.capabilities.savedDeliveryAddresses))
    || value.capabilities.bookingDrafts !== (actions.includes('CREATE_BOOKING_DRAFT') && actions.includes('OPEN_BOOKING'))
    || (value.capabilities.savedDeliveryAddresses && !value.capabilities.bookingDrafts)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent client host capabilities' });
  }
});
export type AiClientHostCapabilities = z.infer<typeof aiClientHostCapabilitiesSchema>;
