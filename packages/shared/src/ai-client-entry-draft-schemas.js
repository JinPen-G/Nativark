"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiClientHostCapabilitiesSchema = exports.aiClientHostCapabilitiesRequestSchema = exports.aiClientSourceReadRequestSchema = exports.aiClientOrderExplanationReadRequestSchema = exports.aiClientTaskEventsReadRequestSchema = exports.aiClientTaskReadRequestSchema = exports.AI_CLIENT_HOST_CAPABILITIES_VERSION = void 0;
const zod_1 = require("zod");
const ai_entry_action_draft_1 = require("./ai-entry-action-draft");
exports.AI_CLIENT_HOST_CAPABILITIES_VERSION = 'ain-client-host-capabilities-1';
const id = zod_1.z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
/** Reads bind the original creation/material reference; no caller task, owner or scope. */
exports.aiClientTaskReadRequestSchema = zod_1.z.object({ creationKey: id.max(128), materialRef: zod_1.z.string().uuid() }).strict();
exports.aiClientTaskEventsReadRequestSchema = exports.aiClientTaskReadRequestSchema.extend({
    after: zod_1.z.string().regex(/^(0|[1-9][0-9]{0,19})$/u), limit: zod_1.z.number().int().min(1).max(100)
}).strict();
exports.aiClientOrderExplanationReadRequestSchema = zod_1.z.object({ orderId: id,
    question: zod_1.z.enum(['status', 'fees']).default('status') }).strict();
exports.aiClientSourceReadRequestSchema = zod_1.z.object({ materialRef: zod_1.z.string().uuid() }).strict();
exports.aiClientHostCapabilitiesRequestSchema = zod_1.z.object({}).strict();
exports.aiClientHostCapabilitiesSchema = zod_1.z.object({
    contractVersion: zod_1.z.literal(exports.AI_CLIENT_HOST_CAPABILITIES_VERSION),
    enabled: zod_1.z.boolean(), audience: zod_1.z.literal('customer'), surface: zod_1.z.enum(ai_entry_action_draft_1.AI_CUSTOMER_ENTRY_SURFACES),
    channel: zod_1.z.enum(['wechat_miniprogram', 'web']),
    customerId: id, customerType: zod_1.z.enum(['personal', 'corporate']), tenantCode: id, serviceCode: id,
    scope: zod_1.z.object({ kind: zod_1.z.literal('workspace'), tenantId: id, workspaceId: id }).strict(),
    policy: zod_1.z.object({ revision: zod_1.z.number().int().min(1).max(4294967294), allowRead: zod_1.z.literal(true), allowCreate: zod_1.z.boolean() }).strict(),
    releaseRevision: id, observedAt: zod_1.z.string().datetime({ offset: true }), expiresAt: zod_1.z.string().datetime({ offset: true }),
    capabilities: zod_1.z.object({
        entryActions: zod_1.z.array(zod_1.z.enum(['OPEN_ORDER', 'CREATE_BOOKING_DRAFT', 'OPEN_BOOKING'])).max(3),
        bookingDrafts: zod_1.z.boolean(), savedDeliveryAddresses: zod_1.z.boolean()
    }).strict(),
    authorization: zod_1.z.literal('observation_only_recheck_each_action')
}).strict().superRefine((value, context) => {
    const actions = value.capabilities.entryActions;
    if (value.surface !== (value.channel === 'web' ? 'tenant_website' : 'client_miniprogram')
        || Date.parse(value.expiresAt) <= Date.parse(value.observedAt)
        || new Set(actions).size !== actions.length
        || value.enabled !== (actions.length > 0)
        || (!value.policy.allowCreate && (value.enabled || value.capabilities.bookingDrafts || value.capabilities.savedDeliveryAddresses))
        || value.capabilities.bookingDrafts !== (actions.includes('CREATE_BOOKING_DRAFT') && actions.includes('OPEN_BOOKING'))
        || (value.capabilities.savedDeliveryAddresses && !value.capabilities.bookingDrafts)) {
        context.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: 'Inconsistent client host capabilities' });
    }
});
//# sourceMappingURL=ai-client-entry-draft-schemas.js.map