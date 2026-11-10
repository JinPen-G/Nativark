/** A current, owned original Task's order/manual reference. Model text and
 * inventory candidates never authorize a business action or an arbitrary URL. */
import { z } from 'zod';
import { RentalCoreOrderStatus } from './core';
import { AI_SCENE_REQUEST_DRAFT_VERSION } from './ai-scene-request-draft';
type HandoffJsonSchema = { type?: string; format?: string; pattern?: string; minLength?: number; maxLength?: number;
  properties?: Record<string, HandoffJsonSchema>; required?: string[]; additionalProperties?: boolean;
  enum?: (string | boolean)[]; items?: HandoffJsonSchema; maxItems?: number; minItems?: number };
const obj = (properties: Record<string, HandoffJsonSchema>, required = Object.keys(properties)): HandoffJsonSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const choice = (...values: string[]): HandoffJsonSchema => ({ type: 'string', enum: values });
const resource = (maxLength = 191): HandoffJsonSchema => ({ type: 'string', minLength: 1, maxLength, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' });
const text = (maxLength: number): HandoffJsonSchema => ({ type: 'string', minLength: 1, maxLength });
const list = (items: HandoffJsonSchema, maxItems: number): HandoffJsonSchema => ({ type: 'array', items, maxItems, minItems: 0 });
const time: HandoffJsonSchema = { type: 'string', format: 'date-time', minLength: 20, maxLength: 40 };
export const AI_TASK_ORDER_HANDOFF_VERSION = 'ain-task-order-handoff-1' as const;
export const AI_TASK_ORDER_HANDOFF_HTTP = { basePath: 'ai-native/task-order-handoff', read: 'read' } as const;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), taskId = id.max(36);
const timestamp = z.string().max(40).datetime({ offset: true });
const scope = z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict();
export const aiTaskOrderHandoffQuery = z.object({ taskId, runId: taskId.optional() }).strict();
const origin = z.object({ draftVersion: z.literal(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u), sceneVersion: id, requestKey: id.max(128) }).strict();
const candidate = z.object({ code: z.literal('rental.order.explain'), version: id, kind: z.literal('readonly'), executable: z.literal(false),
  permission: z.literal('original_route_must_revalidate'), requirements: z.array(z.string().min(1).max(1000)).max(20) }).strict();
export const aiTaskOrderHandoffResponse = z.object({ contractVersion: z.literal(AI_TASK_ORDER_HANDOFF_VERSION), taskId, runId: taskId,
  scope, origin, order: z.object({ id, orderNo: z.string().min(1).max(191), status: z.nativeEnum(RentalCoreOrderStatus), version: timestamp, observedAt: timestamp }).strict(),
  next: z.object({ status: z.literal('candidates_only'), allowedActions: z.literal('unavailable'), candidates: z.array(candidate).max(20),
    manual: z.object({ kind: z.literal('order_resource'), scope, orderId: id, navigation: z.literal('host_existing_order_route'),
      authorization: z.literal('destination_rechecks_permissions') }).strict() }).strict(),
  execution: z.literal('not_attempted'), approval: z.literal('not_granted'), consistency: z.literal('revalidated_reads_not_atomic_snapshot') }).strict()
  .superRefine((value, context) => { if (value.order.id !== value.next.manual.orderId || value.scope.tenantId !== value.next.manual.scope.tenantId
    || value.scope.workspaceId !== value.next.manual.scope.workspaceId) context.addIssue({ code: 'custom', message: 'Original order handoff scope mismatch' }); });
export type AiTaskOrderHandoffQuery = z.infer<typeof aiTaskOrderHandoffQuery>;
export type AiTaskOrderHandoffResponse = z.infer<typeof aiTaskOrderHandoffResponse>;
const scopeSchema = obj({ kind: choice('workspace'), tenantId: resource(), workspaceId: resource() });
const candidateSchema = obj({ code: choice('rental.order.explain'), version: resource(), kind: choice('readonly'), executable: { type: 'boolean', enum: [false] },
  permission: choice('original_route_must_revalidate'), requirements: list(text(1000), 20) });
export const AI_TASK_ORDER_HANDOFF_SCHEMAS = {
  AiTaskOrderHandoffQuery: obj({ taskId: resource(36), runId: resource(36) }, ['taskId']),
  AiTaskOrderHandoffResponse: obj({ contractVersion: choice(AI_TASK_ORDER_HANDOFF_VERSION), taskId: { ...resource(), maxLength: 36 }, runId: { ...resource(), maxLength: 36 },
    scope: scopeSchema, origin: obj({ draftVersion: choice(AI_SCENE_REQUEST_DRAFT_VERSION), inputRef: { type: 'string', format: 'uuid' },
      contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, sceneVersion: resource(), requestKey: { ...resource(), maxLength: 128 } }),
    order: obj({ id: resource(), orderNo: text(191), status: choice(...Object.values(RentalCoreOrderStatus)), version: time, observedAt: time }),
    next: obj({ status: choice('candidates_only'), allowedActions: choice('unavailable'), candidates: list(candidateSchema, 20),
      manual: obj({ kind: choice('order_resource'), scope: scopeSchema, orderId: resource(), navigation: choice('host_existing_order_route'), authorization: choice('destination_rechecks_permissions') }) }),
    execution: choice('not_attempted'), approval: choice('not_granted'), consistency: choice('revalidated_reads_not_atomic_snapshot') })
} as const;
