import { z } from 'zod';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiOrderExplanationFactsService } from './order-explanation-facts.service';
import type { AiOrderNextStepsService } from './order-next-steps.service';
import { sealBusinessScenario } from './business-scenario-input';
import { ModelGatewayError } from '../model-gateway.ports';

const input = z.object({ modelAvailability: z.enum(['not_requested', 'unavailable']).default('not_requested') }).strict();

export class AiOrderExplanationPreparationService {
  constructor(private readonly authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly facts: Pick<AiOrderExplanationFactsService, 'read'>,
    private readonly next: Pick<AiOrderNextStepsService, 'read'>) {}

  async prepare(value: unknown = {}) {
    const parsed = input.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.authority.withOrderRead(async (context, orderId) => {
      const facts = await this.facts.read(context);
      const next = await this.next.read(context);
      const latest = await this.facts.read(context);
      if (latest.orderVersion !== facts.orderVersion) throw new ModelGatewayError('CONFIG_INVALID');
      const gaps = [
        { field: 'actualReceivedTotal', status: facts.actualReceivedTotal.coverage },
        { field: 'fundingLedger', status: facts.fundingLedger.coverage },
        { field: 'inspectionExecution', status: facts.fulfillment.inspectionExecution },
        { field: 'history', status: facts.history.coverage },
        { field: 'payments', status: facts.payments.coverage }
      ];
      return sealBusinessScenario('order_explanation', {
        status: 'facts_only' as const, scope: facts.scope, audience: context.audience,
        orderId, orderVersion: facts.orderVersion, observedAt: facts.observedAt,
        facts, gaps, model: { status: parsed.data.modelAvailability, answer: 'not_generated' as const },
        handoff: { status: 'manual_review_only' as const, resource: next.manual,
          // Existing registered page; host resolves this key, not a model URL.
          operatorRouteKey: context.audience === 'operator' ? 'APP_ROUTES.orderDetail' as const : undefined,
          routeSource: context.audience === 'operator' ? 'apps/admin/src/app/AppRouter.tsx' : undefined,
          candidates: next.candidates, allowedActions: next.allowedActions,
          blockers: ['current_allowed_actions_not_loaded', 'destination_must_reauthorize'],
          informationNeeded: gaps.map(row => row.field),
          execution: 'not_attempted' as const }
      });
    });
  }
}
