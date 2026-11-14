import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiDiagnosticReadAuthority } from '../tools/diagnostic-read-facts.service';
import type { AiOrderExplanationPreparationService } from '../tools/order-explanation-preparation.service';
import type { AiOpeningActionListService } from '../tools/opening-action-list.service';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import type { AiQuoteBusinessPreparationService } from '../tools/quote-business-preparation.service';
import { aiQuoteCandidateInputSchema } from '../tools/quote-candidate-preparation.service';
import { sealBusinessScenario } from '../tools/business-scenario-input';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from '../tools/read-context-binding';
import { originalQuoteGoalInputSchema } from '../task-request/original-request.validation';

const key = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const resourceId = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const orderRequest = z.object({ requestKey: key, orderId: resourceId,
  question: z.enum(['status', 'fees', 'payments', 'next_steps']) }).strict();
const openingRequest = z.object({ requestKey: key,
  sections: z.array(z.string().min(1).max(191)).min(1).max(9)
}).strict().refine(value => new Set(value.sections).size === value.sections.length);
const quoteRequest = z.union([z.object({ requestKey: key, candidate: aiQuoteCandidateInputSchema }).strict(),
  originalQuoteGoalInputSchema.extend({ requestKey: key })]);

/** Internal application preflight, NOT a public DTO or creation authority.
 * Original persistence/policy belong to the original-scenes composition. This
 * service's placeholders are preflight limitations, not an existing task's state.
 * It therefore never manufactures inputRef/revision/creationAllowed,
 * creates a task, registers a step, or invokes a model. All business reads use
 * the existing current Guard and are revalidated before returning the packet.
 * Snapshot the expected original parent before any Guard await. Compare it
 * only after current authorization; the snapshot itself grants nothing. */
export class AiBusinessScenePreparationService {
  constructor(private readonly dependencies: {
    orderAuthority(orderId: string): Pick<AiOrderRouteContextAuthority, 'withOrderRead'>;
    orderMaterial(orderId: string): Pick<AiOrderExplanationPreparationService, 'prepare'>;
    openingAuthority: AiDiagnosticReadAuthority;
    opening: Pick<AiOpeningActionListService, 'read'>;
    quoteAuthority: AiBusinessReadAuthority;
    quote: Pick<AiQuoteBusinessPreparationService, 'prepareInput'> & Partial<Pick<AiQuoteBusinessPreparationService, 'prepareGoalInput'>>;
  }) {}

  private request(context: AiExecutionContext, scene: 'order_explanation' | 'opening_diagnosis' | 'quote_clarification', requestKey: string, body: unknown) {
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
      || !['operator', 'staff'].includes(context.audience)) throw new ModelGatewayError('FORBIDDEN');
    const bound = structuredClone({ scene, scope: context.scope, audience: context.audience,
      ownerKind: context.actor.kind, ownerId: context.actor.userId, body });
    return { ...bound, requestKey, contentHash: requestFingerprint(bound),
      persistence: 'not_attempted_missing_original_request_repository' as const,
      creationAuthority: 'not_granted' as const };
  }

  async prepareQuoteClarification(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = quoteRequest.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = parsed.data, expected = expectedContext && structuredClone(expectedContext);
    return this.dependencies.quoteAuthority.withRead('quote_context', {}, async context => {
      assertAiReadContextBinding(context, expected);
      const goal = 'kind' in input ? { kind: input.kind, draftVersion: input.draftVersion, goalText: input.goalText } : undefined;
      if (goal && !this.dependencies.quote.prepareGoalInput) throw new ModelGatewayError('CONFIG_INVALID');
      const materials = goal ? await this.dependencies.quote.prepareGoalInput!(goal, context)
        : await this.dependencies.quote.prepareInput('candidate' in input ? input.candidate : undefined, 'not_requested', context);
      if (materials.payload.audience !== context.audience || requestFingerprint(materials.payload.scope) !== requestFingerprint(context.scope)) throw new ModelGatewayError('FORBIDDEN');
      return sealBusinessScenario('quote_clarification', {
        status: 'prepared_not_persisted' as const,
        request: this.request(context, 'quote_clarification', input.requestKey, goal ?? ('candidate' in input ? input.candidate : undefined)),
        materials, humanSelection: 'not_attested' as const,
        task: { status: 'unavailable' as const, missing: ['original_request_persistence', 'current_scene_creation_policy'] },
        quotation: 'not_created' as const, orderApproval: 'not_granted' as const,
        execution: 'not_attempted' as const, model: 'not_called' as const
      });
    });
  }

  async prepareOrderExplanation(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = orderRequest.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = parsed.data, expected = expectedContext && structuredClone(expectedContext);
    return this.dependencies.orderAuthority(input.orderId).withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, expected);
      if (orderId !== input.orderId) throw new ModelGatewayError('FORBIDDEN');
      const materials = await this.dependencies.orderMaterial(orderId).prepare({ question: input.question }, context);
      if (materials.payload.orderId !== orderId || materials.payload.audience !== context.audience
        || requestFingerprint(materials.payload.scope) !== requestFingerprint(context.scope)) throw new ModelGatewayError('FORBIDDEN');
      return sealBusinessScenario('order_explanation', {
        status: 'prepared_not_persisted' as const,
        request: this.request(context, 'order_explanation', input.requestKey, { orderId, question: input.question }),
        materials, task: { status: 'unavailable' as const, missing: ['original_request_persistence', 'current_scene_creation_policy'] },
        execution: 'not_attempted' as const, model: 'not_called' as const
      });
    });
  }

  async prepareOpeningDiagnosis(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = openingRequest.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = parsed.data, expected = expectedContext && structuredClone(expectedContext);
    return this.dependencies.openingAuthority.withRead('opening', { limit: 50 }, async context => {
      assertAiReadContextBinding(context, expected);
      const current = await this.dependencies.opening.read({}, context);
      if (current.audience !== context.audience || requestFingerprint(current.scope) !== requestFingerprint(context.scope)) throw new ModelGatewayError('FORBIDDEN');
      if (input.sections.some(key => !current.sections.some(row => row.key === key))) throw new ModelGatewayError('INVALID_REQUEST');
      const selected = new Set(input.sections);
      // Output selection only; the legacy context source still reads its
      // authorized combined config. Do not claim per-section DB pushdown.
      const configuration = {
        ...(selected.has('item_groups') ? { products: current.configuration.products } : {}),
        ...(selected.has('pricing_groups_rates') || selected.has('business_rule') || selected.has('price_version') ? { pricing: current.configuration.pricing } : {}),
        ...(selected.has('fulfillment_network') ? { fulfillment: current.configuration.fulfillment } : {}),
        ...(selected.has('item_groups') ? { inventory: current.configuration.inventory } : {})
      };
      return sealBusinessScenario('opening_diagnosis', {
        status: 'prepared_not_persisted' as const,
        request: this.request(context, 'opening_diagnosis', input.requestKey, { sections: [...input.sections].sort() }),
        materials: { scope: current.scope, audience: current.audience, configVersion: current.configVersion,
          categorySource: current.categorySource, capabilityObservation: current.capabilityObservation,
          ...(current.integrationObservation ? { integrationObservation: current.integrationObservation } : {}),
          ...(selected.has('business_calendar') && current.calendarSource ? { calendarSource: current.calendarSource } : {}),
          observedAt: current.observedAt, sections: current.sections.filter(row => selected.has(row.key)), configuration,
          atomicity: current.atomicity, externalVerification: 'not_loaded' as const },
        task: { status: 'unavailable' as const, missing: ['original_request_persistence', 'current_scene_creation_policy'] },
        execution: 'not_attempted' as const, model: 'not_called' as const
      });
    });
  }
}
