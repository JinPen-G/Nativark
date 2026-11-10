/** Current Core stock for one original human selection, under the existing
 * availability Guard. It neither refreshes the quote nor reserves, reselects,
 * approves or executes an order; unavailable stock remains an observation. */
import { z } from 'zod';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { checkedAiAvailabilityResult } from '../availability-read-facts.service';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { assertAiReadContextBinding } from '../tools/read-context-binding';
import { PrismaQuoteSelectionRepository } from '../task-request/prisma-quote-selection.repository';
import { parseQuoteSelectionProof } from '../task-request/quote-selection.validation';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import type { HumanQuoteOrderDependencies } from './human-quote-order.composition';

export function composeSelectedQuoteStockReview(dependencies: HumanQuoteOrderDependencies & {
  core: Partial<Pick<RentalCoreService, 'readAvailability'>>;
}) {
  const selections = new PrismaQuoteSelectionRepository(dependencies);
  const clock = dependencies.clock ?? (() => new Date());
  const routes = new AiBusinessReadRouteAuthority(dependencies.guard, dependencies.credentials, clock);
  return async (value: unknown) => {
    const parsed = z.object({ selection: z.unknown() }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const readAvailability = dependencies.core.readAvailability;
    if (typeof readAvailability !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const reference = parseQuoteSelectionProof(parsed.data.selection);
    const before = await selections.readAuthorized(reference);
    const body = before.body;
    const request = freezeOriginalInput({ locationId: body.fulfillmentLocationId, startAt: body.startAt,
      endAt: body.endAt, lines: body.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })) });
    const observed = await routes.withRead('availability', request, async context => {
      assertAiReadContextBinding(context, before.context);
      if (context.scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return freezeOriginalInput(structuredClone(await readAvailability.call(dependencies.core, context.scope.tenantId, request)));
    });
    let result;
    try { result = checkedAiAvailabilityResult(request, observed); }
    catch { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }
    const after = await selections.readAuthorized(reference);
    assertAiReadContextBinding(after.context, before.context);
    // Reauthorization refreshes correlation and time; selection facts must still match.
    const { context: beforeContext, ...beforeSelection } = before;
    const { context: afterContext, ...afterSelection } = after;
    if (requestFingerprint(beforeSelection) !== requestFingerprint(afterSelection)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const observedAt = clock();
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()) || Date.parse(before.expiresAt) <= observedAt.getTime()) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    return freezeOriginalInput({ selection: reference, quoteId: before.quoteId, availability: result,
      observedAt: observedAt.toISOString(), inventory: 'observed_not_reserved' as const,
      quote: 'original_unchanged' as const, reselection: 'explicit_user_required' as const,
      approval: 'not_granted' as const, execution: 'not_attempted' as const });
  };
}
