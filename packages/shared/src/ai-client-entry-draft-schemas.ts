import { z } from 'zod';
import { AI_CUSTOMER_ENTRY_SURFACES } from './ai-entry-action-draft';

export const AI_CLIENT_HOST_CAPABILITIES_VERSION = 'ain-client-host-capabilities-1' as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
/** Reads bind the original creation/material reference; no caller task, owner or scope. */
export const aiClientTaskReadRequestSchema = z.object({ creationKey: id.max(128), materialRef: z.string().uuid() }).strict();
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
