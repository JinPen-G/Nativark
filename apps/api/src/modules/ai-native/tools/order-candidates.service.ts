/** Current-authorized bounded Core order discovery. No aggregate reload,
 * financial projection, task creation, model call or inferred due-date rules. */
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, aiOrderCandidatesPageSchema, aiOrderCandidatesQuerySchema,
  type AiExecutionContext, type AiOrderCandidatesPageDraft } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from './read-context-binding';

const rowSchema = aiOrderCandidatesPageSchema.shape.items.element.omit({ source: true }).extend({
  tenantId: z.string().min(1).max(191)
}).strip(); // Core's full order projection is deliberately reduced to these fields.
export class AiOrderCandidatesService {
  constructor(private readonly core: Pick<RentalCoreService, 'queryOrders'> | undefined,
    private readonly authority: AiBusinessReadAuthority, private readonly clock: () => Date = () => new Date()) {}

  async read(value: unknown, expectedContext?: AiExecutionContext): Promise<AiOrderCandidatesPageDraft> {
    const parsed = aiOrderCandidatesQuerySchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    // Retain the original server parent before the Guard yields. Neither this
    // assertion nor the discovered order IDs grant access to their later reads.
    const parent = expectedContext && structuredClone(expectedContext);
    return this.authority.withRead('order_candidates', parsed.data, async context => {
      assertAiReadContextBinding(context, parent);
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
        || !['operator', 'staff'].includes(context.audience)) throw new ModelGatewayError('FORBIDDEN');
      const scope = context.scope;
      if (typeof this.core?.queryOrders !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      // Always supply both paging fields. The original Core API's compatibility
      // form without them is unpaged and must never be used by this reader.
      const page = await this.core.queryOrders(scope.tenantId, structuredClone(parsed.data));
      if (!page || page.page !== parsed.data.page || page.pageSize !== parsed.data.pageSize
        || !Array.isArray(page.items) || page.items.length > parsed.data.pageSize
        || !Number.isSafeInteger(page.total) || page.total < 0) throw new ModelGatewayError('INVALID_RESPONSE');
      const rows = page.items.map(row => rowSchema.safeParse(row));
      if (rows.some(row => !row.success || row.data.tenantId !== scope.tenantId)
        || new Set(page.items.map(row => row.id)).size !== page.items.length) throw new ModelGatewayError('INVALID_RESPONSE');
      const observed = this.clock();
      if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
      const result = aiOrderCandidatesPageSchema.safeParse({ contractVersion: AI_CONTRACT_DRAFT_VERSION,
        requestId: context.requestId, audience: context.audience, scope: context.scope,
        observedAt: observed.toISOString(), query: parsed.data,
        items: rows.map(row => { const { tenantId: _, ...item } = row.data!;
          return { ...item, source: { kind: 'order', id: item.id, version: item.updatedAt } }; }),
        total: page.total, hasMore: parsed.data.page * parsed.data.pageSize < page.total,
        coverage: 'page_of_current_visible_orders', timeMeaning: 'rental_interval_overlap_not_order_creation_or_pickup_due',
        consistency: 'current_non_atomic_observation', execution: 'not_attempted', trust: 'business_data_not_model_instructions' });
      if (!result.success) throw new ModelGatewayError('INVALID_RESPONSE');
      return result.data;
    });
  }
}
