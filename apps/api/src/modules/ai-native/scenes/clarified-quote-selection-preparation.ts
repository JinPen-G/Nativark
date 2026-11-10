/** Canonical clarified Core quote -> original human selection command/material.
 * Read-only: no default quote, customer/address substitution, selection save,
 * proposal, approval or order dispatch. Fulfillment/address/services remain
 * facts of that exact quote snapshot; current stock is re-read through Core
 * before selection. The public contract is reused, never widened to accept
 * caller address, price, availability or payer overrides. */
import { AI_QUOTE_SELECTION_DRAFT_VERSION, type AiClarifiedQuoteSelectionPreparationInputDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { checkedAiAvailabilityResult } from '../availability-read-facts.service';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { parseQuoteSelection, validateQuoteSelectionHttpRequest } from '../task-request/quote-selection.validation';
import { approvedOrderReviewMaterial } from '../approval-execution/approved-order-review-material';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiSceneHttpRequest } from './request-bound-scenes.application';
import type { composeClarifiedQuoteSelectionRequests } from './request-bound-scenes.application';
import type { HumanQuoteSelectionDependencies } from '../task-request/prisma-quote-selection.repository';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { assertAiReadContextBinding } from '../tools/read-context-binding';
import type { RentalCoreService } from '../../rental-core/rental-core.service';

export function composeClarifiedQuoteSelectionPreparation(
  model: Parameters<typeof composeClarifiedQuoteSelectionRequests>[0],
  dependencies: Pick<HumanQuoteSelectionDependencies, 'quoteFacts' | 'guard' | 'credentials' | 'clock'>
    & { core: Partial<Pick<RentalCoreService, 'readAvailability'>> }) {
  if (typeof model?.readClarifiedQuoteReceipt !== 'function' || typeof dependencies.quoteFacts?.findQuote !== 'function'
    || typeof dependencies.core?.readAvailability !== 'function')
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const binding = (value: Awaited<ReturnType<typeof model.readClarifiedQuoteReceipt>>) => 'result' in value
    ? requestFingerprint({ original: value.original, receipt: value.receipt, status: value.result.status,
      scope: value.result.scope, quote: value.result.quote }) : null;
  return Object.freeze({
    async prepareSelection(request: AiSceneHttpRequest, value: unknown) {
      const command = validateQuoteSelectionHttpRequest('AiClarifiedQuoteSelectionPreparationInputDraft', value) as AiClarifiedQuoteSelectionPreparationInputDraft;
      const currentRequest = freezeOriginalInput({ headers: { authorization: request?.headers?.authorization } });
      const read = () => model.readClarifiedQuoteReceipt(currentRequest, command.clarification);
      const original = freezeOriginalInput(structuredClone(await read()));
      if (!('result' in original) || original.receipt.state !== 'observed' || original.result.status !== 'quoted'
        || !original.result.quote || original.original.inputRef !== command.clarification.original.inputRef)
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const publicQuote = original.result.quote, originalScope = original.result.scope;
      const routes = new AiBusinessReadRouteAuthority(dependencies.guard, { current: async () => {
        const current = await dependencies.credentials.current();
        if (typeof currentRequest.headers.authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return { ...current, authorization: currentRequest.headers.authorization };
      } }, dependencies.clock);
      // Public quote material intentionally omits full request/member/address
      // snapshots. Read those only through the original server Core quote port,
      // under the same request's Guard/ALS; never cast the public projection.
      const readCore = () => routes.withRead('quote_context', {}, async context => {
        if (context.scope.kind !== 'workspace' || context.audience !== 'operator'
          || requestFingerprint(context.scope) !== requestFingerprint(originalScope)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const quote = await dependencies.quoteFacts.findQuote(context.scope.tenantId, publicQuote.id);
        if (!quote || quote.id !== publicQuote.id || quote.tenantId !== context.scope.tenantId
          || quote.request.startAt !== publicQuote.period.startAt || quote.request.endAt !== publicQuote.period.endAt)
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        for (const key of ['currency', 'rentalAmount', 'discountAmount', 'couponAmount', 'serviceAmount', 'fulfillmentAmount',
          'depositAmount', 'preAuthAmount', 'payableAmount', 'receivableAmount', 'createdAt', 'expiresAt', 'ruleVersion', 'calendarVersion'] as const) {
          if (requestFingerprint(quote[key]) !== requestFingerprint(publicQuote[key])) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        }
        return freezeOriginalInput({ quote: structuredClone(quote), context: structuredClone(context) });
      });
      const first = await readCore(), quote = first.quote, body = quote.request;
      const clock = dependencies.clock ?? (() => new Date());
      const assertUsableQuote = (value: typeof quote) => {
        const now = clock(), expiry = Date.parse(value.expiresAt);
        if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isFinite(expiry)
          || expiry <= now.getTime() || value.consumedAt || value.consumedOrderId)
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      };
      assertUsableQuote(quote);
      // A ready quote is not a current independent corporate payer grant. Keep
      // the existing self-paid boundary; never infer a company from intent.
      if (body.customerType !== 'personal' || !body.customerId || body.deliveryAddressDraft
        || body.bookingIdentity?.enterpriseContractAndPayer === true) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const customerName = quote.membershipSnapshot?.personalCustomerName;
      if (!customerName || quote.membershipSnapshot?.personalCustomerId !== body.customerId)
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const selection = parseQuoteSelection({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION,
        originalInputRef: original.original.inputRef, taskId: original.receipt.taskId, runId: original.receipt.runId,
        selectionKey: command.selectionKey, expectedSelectionRevision: command.expectedSelectionRevision,
        order: { quoteId: quote.id, customerType: body.customerType, customerId: body.customerId, customerName,
          ...(body.bookingIdentity ? { bookingIdentity: body.bookingIdentity } : {}), fulfillmentMode: body.fulfillmentMode,
          fulfillmentLocationId: body.fulfillmentLocationId, ...(body.returnLocationId ? { returnLocationId: body.returnLocationId } : {}),
          startAt: body.startAt, endAt: body.endAt, lines: body.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity,
            ...(line.pricingGroupId ? { pricingGroupId: line.pricingGroupId } : {}), ...(line.note ? { note: line.note } : {}) })) }
      });
      const material = approvedOrderReviewMaterial(selection.order, quote);
      // The immutable quote explains its original price; it cannot attest today's
      // stock. Query the SAME period/location/quantities under the original read
      // Guard before offering a selectable command. No reservation or substitute.
      const availabilityInput = freezeOriginalInput({ locationId: body.fulfillmentLocationId,
        startAt: body.startAt, endAt: body.endAt,
        lines: body.lines.map(line => {
          // This original R0 port accepts exact models, not a current pricing-group
          // substitution. Missing original resolution stays unavailable.
          if (typeof line.itemGroupId !== 'string' || !line.itemGroupId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return { itemGroupId: line.itemGroupId, quantity: line.quantity };
        }) });
      const readStock = () => routes.withRead('availability', availabilityInput, async context => {
        assertAiReadContextBinding(context, first.context);
        if (context.scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return freezeOriginalInput(structuredClone(await dependencies.core.readAvailability!.call(dependencies.core,
          context.scope.tenantId, availabilityInput)));
      });
      const assertAvailable = (availability: Awaited<ReturnType<typeof readStock>>) => {
        let checked;
        try { checked = checkedAiAvailabilityResult(availabilityInput, availability); }
        catch { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }
        if (checked.available !== true)
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      };
      assertAvailable(await readStock());
      const latest = await readCore();
      assertAiReadContextBinding(latest.context, first.context);
      const latestOriginal = await read();
      // The original receipt read can wait while this exact Core quote is
      // consumed or expires. Close that wait with the original quote/Guard,
      // not a new quote or a historical receipt's implied execution authority.
      const closing = await readCore();
      assertAiReadContextBinding(closing.context, first.context);
      if (requestFingerprint(latest.quote) !== requestFingerprint(quote)
        || requestFingerprint(closing.quote) !== requestFingerprint(quote) || binding(latestOriginal) !== binding(original))
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      assertUsableQuote(closing.quote);
      // The receipt/quote waits may withdraw stock without changing the quote.
      // Recheck the same Core request, not an exact stock-version equality:
      // changed quantities can still satisfy the human's original selection.
      // This remains an observation, never a reservation or execution grant.
      assertAvailable(await readStock());
      const afterStock = await readCore();
      assertAiReadContextBinding(afterStock.context, first.context);
      if (requestFingerprint(afterStock.quote) !== requestFingerprint(quote)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      assertUsableQuote(afterStock.quote);
      return freezeOriginalInput({ selection, clarification: command.clarification, material,
        quote: { id: quote.id, originalOperation: 'read_only' as const },
        selectionState: 'not_saved' as const, quotation: 'original_unchanged' as const,
        approval: 'not_granted' as const, order: 'not_created' as const,
        nextAction: 'explicit_human_selection_then_original_approval' as const });
    }
  });
}
