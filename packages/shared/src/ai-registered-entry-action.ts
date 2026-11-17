/** Versioned nine-Action transport using the original shared registry. The
 * legacy customer v1 remains valid only for its three original operations.
 * A valid shape or sealed proof never replaces current destination authority. */
import { z } from 'zod';
import { AI_ENTRY_ACTION_CODES, AI_ENTRY_ACTION_REGISTRY } from './ai-entry-action-draft';

export const AI_REGISTERED_ENTRY_ACTION_VERSION = 'ain-entry-action-2' as const;
export const AI_REGISTERED_ENTRY_ACTION_HTTP = {
  operatorBasePath: 'ai-native/entry-actions', staffBasePath: 'staff/v1/ai-native/entry-actions',
  websiteBasePath: 'client/v1/ai-native/website/entry-actions', wechatBasePath: 'client/v1/ai-native/wechat/entry-actions',
  issue: 'issue', revalidate: 'revalidate', fromOrder: 'from-order',
} as const;
export const AI_REGISTERED_ENTRY_SURFACE_AUDIENCE = {
  tenant_admin: 'operations', staff_miniprogram: 'staff', tenant_website: 'customer', client_miniprogram: 'customer',
} as const;
export type AiRegisteredEntrySurface = keyof typeof AI_REGISTERED_ENTRY_SURFACE_AUDIENCE;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().max(40).datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const scope = z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict();
const source = z.union([z.object({ taskId: id.max(36), runId: id.max(36).optional() }).strict(),
  z.object({ orderId: id }).strict()]);
const resource = z.object({ kind: z.enum(['order', 'customer', 'item_group', 'customer_profile', 'payment',
  'order_allocation', 'booking_draft', 'quote', 'notification_draft']), id, resourceVersion: hash,
  customerType: z.enum(['personal', 'corporate']).optional() }).strict();
const associations = z.object({ materialRef: z.string().uuid().nullable(), taskId: id.max(36).nullable(), runId: id.max(36).nullable(),
  proposalId: id.max(36).nullable(), quoteId: id.nullable(), bookingDraftId: z.string().uuid().nullable(), orderId: id.nullable() }).strict();
export const aiRegisteredEntryActionSchema = z.object({
  contractVersion: z.literal(AI_REGISTERED_ENTRY_ACTION_VERSION), actionId: z.string().uuid(), actionCode: z.enum(AI_ENTRY_ACTION_CODES),
  audience: z.enum(['operations', 'staff', 'customer']),
  surface: z.enum(['tenant_admin', 'staff_miniprogram', 'tenant_website', 'client_miniprogram']), scope, resource,
  requiresConfirmation: z.boolean(), riskLevel: z.enum(['R0', 'R1']), issuedAt: timestamp, expiresAt: timestamp,
  inputFingerprint: hash, bindingFingerprint: hash, policyFingerprint: hash, associations,
  proof: z.string().min(1).max(12288).regex(/^v2:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/u),
}).strict().superRefine((value, context) => {
  const rule = AI_ENTRY_ACTION_REGISTRY[value.actionCode];
  if (AI_REGISTERED_ENTRY_SURFACE_AUDIENCE[value.surface] !== value.audience
    || !(rule.audiences as readonly string[]).includes(value.audience)
    || value.resource.kind !== rule.resourceKind || value.riskLevel !== rule.riskLevel
    || value.requiresConfirmation !== rule.requiresConfirmation || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
    || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 120000)
    context.addIssue({ code: 'custom', message: 'Invalid registered Action binding' });
  if (value.actionCode === 'OPEN_CUSTOMER' ? !value.resource.customerType : value.resource.customerType !== undefined)
    context.addIssue({ code: 'custom', message: 'Customer destination kind must come from the original resource' });
  if ((value.actionCode === 'OPEN_ORDER' || value.actionCode === 'OPEN_DISPATCH') && value.associations.orderId !== value.resource.id)
    context.addIssue({ code: 'custom', message: 'Original order association mismatch' });
  if (value.actionCode === 'OPEN_PROFILE' && value.associations.taskId !== null)
    context.addIssue({ code: 'custom', message: 'Profile navigation cannot borrow another Task owner' });
});
export const aiRegisteredEntryActionIssueSchema = z.object({ actionCode: z.enum(AI_ENTRY_ACTION_CODES), targetId: id,
  source: source.optional() }).strict();
export const aiRegisteredEntryActionReadSchema = z.object({ action: aiRegisteredEntryActionSchema }).strict();
export const aiRegisteredEntryActionOrderSourceSchema = source;
export const aiRegisteredEntryActionObservationSchema = z.object({ contractVersion: z.literal(AI_REGISTERED_ENTRY_ACTION_VERSION),
  action: aiRegisteredEntryActionSchema, label: z.string().min(1).max(191), observedAt: timestamp,
  execution: z.literal('not_attempted'), authorization: z.literal('recheck_current_original_resource') }).strict();
export const aiRegisteredEntryActionRevalidationSchema = z.object({ contractVersion: z.literal(AI_REGISTERED_ENTRY_ACTION_VERSION),
  actionId: z.string().uuid(), actionCode: z.enum(AI_ENTRY_ACTION_CODES), audience: z.enum(['operations', 'staff', 'customer']),
  surface: z.enum(['tenant_admin', 'staff_miniprogram', 'tenant_website', 'client_miniprogram']), scope, resource, associations,
  observedAt: timestamp, state: z.literal('revalidated'), execution: z.literal('not_attempted'),
  navigation: z.literal('fixed_destination_rechecks_authority') }).strict();
export const aiRegisteredEntryActionOrderResponseSchema = z.object({ contractVersion: z.literal(AI_REGISTERED_ENTRY_ACTION_VERSION),
  source, orderId: id, scope, observedAt: timestamp, actions: z.array(aiRegisteredEntryActionObservationSchema).max(44),
  execution: z.literal('not_attempted'), businessApproval: z.literal('not_granted') }).strict();
export type AiRegisteredEntryAction = z.infer<typeof aiRegisteredEntryActionSchema>;
export type AiRegisteredEntryActionIssue = z.infer<typeof aiRegisteredEntryActionIssueSchema>;
export type AiRegisteredEntryActionObservation = z.infer<typeof aiRegisteredEntryActionObservationSchema>;
export type AiRegisteredEntryActionRead = z.infer<typeof aiRegisteredEntryActionReadSchema>;
export type AiRegisteredEntryActionRevalidation = z.infer<typeof aiRegisteredEntryActionRevalidationSchema>;
export type AiRegisteredEntryActionOrderSource = z.infer<typeof aiRegisteredEntryActionOrderSourceSchema>;
export type AiRegisteredEntryActionOrderResponse = z.infer<typeof aiRegisteredEntryActionOrderResponseSchema>;

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean;
  enum?: readonly (string | boolean | null)[]; format?: string; pattern?: string; minLength?: number; maxLength?: number;
  items?: Schema; maxItems?: number; anyOf?: readonly Schema[]; $ref?: string };
const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const str = (maxLength = 191): Schema => ({ type: 'string', minLength: 1, maxLength });
const key: Schema = { ...str(), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const digest: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const date: Schema = { ...str(40), format: 'date-time' };
const choice = (...values: string[]): Schema => ({ type: 'string', enum: values });
const nullable = (value: Schema): Schema => ({ anyOf: [value, { type: 'null' }] });
const scopeJson = obj({ kind: choice('workspace'), tenantId: key, workspaceId: key });
const sourceJson: Schema = { anyOf: [obj({ taskId: { ...key, maxLength: 36 }, runId: { ...key, maxLength: 36 } }, ['taskId']),
  obj({ orderId: key })] };
const resourceJson = obj({ kind: choice('order', 'customer', 'item_group', 'customer_profile', 'payment', 'order_allocation',
  'booking_draft', 'quote', 'notification_draft'), id: key, resourceVersion: digest, customerType: choice('personal', 'corporate') },
  ['kind', 'id', 'resourceVersion']);
const associationsJson = obj({ materialRef: nullable({ type: 'string', format: 'uuid' }), taskId: nullable({ ...key, maxLength: 36 }), runId: nullable({ ...key, maxLength: 36 }),
  proposalId: nullable({ ...key, maxLength: 36 }), quoteId: nullable(key), bookingDraftId: nullable({ type: 'string', format: 'uuid' }), orderId: nullable(key) });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const actionJson = obj({ contractVersion: choice(AI_REGISTERED_ENTRY_ACTION_VERSION), actionId: { type: 'string', format: 'uuid' },
  actionCode: choice(...AI_ENTRY_ACTION_CODES), audience: choice('operations', 'staff', 'customer'),
  surface: choice('tenant_admin', 'staff_miniprogram', 'tenant_website', 'client_miniprogram'), scope: scopeJson, resource: resourceJson,
  requiresConfirmation: { type: 'boolean' }, riskLevel: choice('R0', 'R1'), issuedAt: date, expiresAt: date,
  inputFingerprint: digest, bindingFingerprint: digest, policyFingerprint: digest, associations: associationsJson,
  proof: { ...str(12288), pattern: '^v2:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$' } });
export const AI_REGISTERED_ENTRY_ACTION_SCHEMAS: Record<string, Schema> = {
  AiRegisteredEntryAction: actionJson,
  AiRegisteredEntryActionIssue: obj({ actionCode: choice(...AI_ENTRY_ACTION_CODES), targetId: key, source: sourceJson }, ['actionCode', 'targetId']),
  AiRegisteredEntryActionRead: obj({ action: ref('AiRegisteredEntryAction') }),
  AiRegisteredEntryActionOrderSource: sourceJson,
  AiRegisteredEntryActionObservation: obj({ contractVersion: choice(AI_REGISTERED_ENTRY_ACTION_VERSION), action: ref('AiRegisteredEntryAction'),
    label: str(), observedAt: date, execution: choice('not_attempted'), authorization: choice('recheck_current_original_resource') }),
  AiRegisteredEntryActionRevalidation: obj({ contractVersion: choice(AI_REGISTERED_ENTRY_ACTION_VERSION), actionId: { type: 'string', format: 'uuid' },
    actionCode: choice(...AI_ENTRY_ACTION_CODES), audience: choice('operations', 'staff', 'customer'),
    surface: choice('tenant_admin', 'staff_miniprogram', 'tenant_website', 'client_miniprogram'), scope: scopeJson,
    resource: resourceJson, associations: associationsJson, observedAt: date, state: choice('revalidated'),
    execution: choice('not_attempted'), navigation: choice('fixed_destination_rechecks_authority') }),
  AiRegisteredEntryActionOrderResponse: obj({ contractVersion: choice(AI_REGISTERED_ENTRY_ACTION_VERSION), source: sourceJson,
    orderId: key, scope: scopeJson, observedAt: date, actions: { type: 'array', items: ref('AiRegisteredEntryActionObservation'), maxItems: 44 },
    execution: choice('not_attempted'), businessApproval: choice('not_granted') }),
};
export const AI_REGISTERED_ENTRY_ACTION_CONTRACTS = {
  issue: { request: 'AiRegisteredEntryActionIssue', response: 'AiRegisteredEntryActionObservation' },
  revalidate: { request: 'AiRegisteredEntryActionRead', response: 'AiRegisteredEntryActionRevalidation' },
  fromOrder: { request: 'AiRegisteredEntryActionOrderSource', response: 'AiRegisteredEntryActionOrderResponse' },
} as const;
