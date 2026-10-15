import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from './read-context-binding';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const time = z.string().max(40).datetime({ offset: true });
const order = z.object({ id, tenantId: id, updatedAt: time });
const records = z.array(z.object({ id, tenantId: id, orderId: id,
  stage: z.enum(['pickup', 'return']), templateId: id, templateCode: z.string().min(1).max(191),
  templateVersion: z.string().min(1).max(191), exchangeId: id.optional(), baselineInspectionId: id.optional(),
  createdAt: time, exceptions: z.array(z.object({ code: z.string().min(1).max(191),
    description: z.string().max(2000), allocationId: id.optional(),
    reviewStatus: z.enum(['pending', 'approved', 'rejected']),
    customerResponseStatus: z.enum(['not_required', 'pending', 'confirmed', 'disputed']).optional()
  })).max(50)
})).max(50);

/** Existing order inspection read only. No result JSON, attachment URLs,
 * operators, responsibility inference or charge calculation leaves this port. */
export class AiOrderInspectionFactsService {
  constructor(private readonly core: Pick<RentalCoreService, 'getOrder' | 'listInspectionsPage'>,
    private readonly authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof core?.getOrder !== 'function' || typeof core?.listInspectionsPage !== 'function'
      || typeof authority?.withOrderRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }

  async read(expectedContext?: AiExecutionContext) {
    return this.authority.withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, expectedContext);
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const scope = structuredClone(context.scope);
      const before = order.parse(await this.core.getOrder(scope.tenantId, orderId));
      if (before.id !== orderId || before.tenantId !== scope.tenantId) throw new ModelGatewayError('FORBIDDEN');
      const page = await this.core.listInspectionsPage(scope.tenantId, orderId, { limit: 50 });
      const current = records.parse(page?.items);
      if (page.coverage !== 'page_not_total' || !(page.nextCursor === null || id.safeParse(page.nextCursor).success)
        || (page.nextCursor !== null && (current.length !== 50 || page.nextCursor !== current.at(-1)?.id))) {
        throw new ModelGatewayError('INVALID_RESPONSE');
      }
      if (new Set(current.map(row => row.id)).size !== current.length
        || current.some(row => row.orderId !== orderId || row.tenantId !== scope.tenantId)) throw new ModelGatewayError('FORBIDDEN');
      if (Buffer.byteLength(JSON.stringify(current), 'utf8') > 32768) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      const latest = order.parse(await this.core.getOrder(scope.tenantId, orderId));
      if (requestFingerprint(before) !== requestFingerprint(latest)) throw new ModelGatewayError('CONFIG_INVALID');
      const observed = this.clock();
      if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
      return { scope, audience: context.audience, orderId,
        sourceOrderUpdatedAt: before.updatedAt, observedAt: observed.toISOString(),
        records: current.map(({ tenantId: _tenant, orderId: _order, ...row }) => row),
        coverage: 'partial' as const, pageCoverage: page.coverage,
        truncated: page.nextCursor !== null, nextCursor: page.nextCursor,
        queryBound: 'persisted_core_page_limit_plus_one' as const, queryLimit: 50, queryPages: 1,
        semantics: 'recorded_inspection_and_review_only_not_liability_or_settlement' as const,
        attachments: 'not_loaded' as const, execution: 'not_attempted' as const };
    });
  }
}
