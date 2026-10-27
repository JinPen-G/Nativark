/** Bounded order discovery before the existing original-order explanation.
 * Reuses Core filter meanings; not a new query language or execution grant. */
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION } from './ai-native';
import { RentalCoreOrderStatus } from './core';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const time = z.string().max(40).datetime({ offset: true });
export const aiOrderCandidatesQuerySchema = z.object({
  page: z.number().int().min(1).max(500).default(1),
  pageSize: z.number().int().min(1).max(20).default(20),
  status: z.nativeEnum(RentalCoreOrderStatus).optional(),
  keyword: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]*$/u).optional(),
  from: time.optional(), to: time.optional(), pendingFeeOnly: z.boolean().optional()
}).strict().refine(value => !value.from || !value.to || Date.parse(value.from) < Date.parse(value.to));
const item = z.object({ id, orderNo: z.string().min(1).max(191), status: z.nativeEnum(RentalCoreOrderStatus),
  startAt: time, endAt: time, effectiveEndAt: time.optional(), updatedAt: time,
  source: z.object({ kind: z.literal('order'), id, version: time }).strict() }).strict();
export const aiOrderCandidatesPageSchema = z.object({
  contractVersion: z.literal(AI_CONTRACT_DRAFT_VERSION), requestId: id,
  audience: z.enum(['operator', 'staff']),
  scope: z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict(),
  observedAt: time, query: aiOrderCandidatesQuerySchema,
  items: z.array(item).max(20), total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  hasMore: z.boolean(), coverage: z.literal('page_of_current_visible_orders'),
  timeMeaning: z.literal('rental_interval_overlap_not_order_creation_or_pickup_due'),
  consistency: z.literal('current_non_atomic_observation'),
  execution: z.literal('not_attempted'), trust: z.literal('business_data_not_model_instructions')
}).strict();
export type AiOrderCandidatesQueryDraft = z.infer<typeof aiOrderCandidatesQuerySchema>;
export type AiOrderCandidatesPageDraft = z.infer<typeof aiOrderCandidatesPageSchema>;

const key = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const date = { type: 'string', maxLength: 40, format: 'date-time' };
const closed = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const query = closed({ page: { type: 'integer', minimum: 1, maximum: 500, description: 'Defaults to 1 when omitted.' },
  pageSize: { type: 'integer', minimum: 1, maximum: 20, description: 'Defaults to 20 when omitted.' },
  status: { enum: Object.values(RentalCoreOrderStatus) }, keyword: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[^\u0000-\u001f\u007f]*$' },
  from: date, to: date, pendingFeeOnly: { type: 'boolean' } }, []);
export const AI_ORDER_CANDIDATES_SCHEMAS = Object.freeze({
  AiOrderCandidatesQueryDraft: query,
  AiOrderCandidatesPageDraft: closed({ contractVersion: { const: AI_CONTRACT_DRAFT_VERSION }, requestId: key,
    audience: { enum: ['operator', 'staff'] }, scope: closed({ kind: { const: 'workspace' }, tenantId: key, workspaceId: key }),
    observedAt: date, query: { ...query, required: ['page', 'pageSize'] }, total: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    hasMore: { type: 'boolean' }, items: { type: 'array', maxItems: 20, items: closed({ id: key,
      orderNo: { type: 'string', minLength: 1, maxLength: 191 }, status: { enum: Object.values(RentalCoreOrderStatus) },
      startAt: date, endAt: date, effectiveEndAt: date, updatedAt: date,
      source: closed({ kind: { const: 'order' }, id: key, version: date }) },
    ['id', 'orderNo', 'status', 'startAt', 'endAt', 'updatedAt', 'source']) },
    coverage: { const: 'page_of_current_visible_orders' },
    timeMeaning: { const: 'rental_interval_overlap_not_order_creation_or_pickup_due' },
    consistency: { const: 'current_non_atomic_observation' }, execution: { const: 'not_attempted' },
    trust: { const: 'business_data_not_model_instructions' } })
});
