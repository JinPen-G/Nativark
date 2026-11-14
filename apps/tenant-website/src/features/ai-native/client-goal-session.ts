/** Web host for the canonical client goal lifecycle. The browser AbortSignal
 * belongs here; original keys, receipts and selection semantics remain shared. */
import { createClientGoalSession as createSharedClientGoalSession, aiBookingSelectionSchema,
  aiClientQuoteConfirmationRequestSchema, clientGoalStorageKey as goalStorageKey, type ClientGoalBookingSource,
  type ClientGoalApi as SharedClientGoalApi } from '@rental-os/shared';
import type { ClientGoalApi } from './client-goal-api';
import { createClientQuoteBookingSession, clientQuoteBookingStoredRequest } from './client-quote-session';
export { clientGoalStorageKey, clientGoalTextHash, clientGoalTimeOptions, clientGoalSelectedInput } from '@rental-os/shared';
export type { ClientGoalContext, ClientGoalFormSources, ClientGoalView } from '@rental-os/shared';
export type { ClientQuoteBookingView } from './client-quote-session';

export function createClientGoalSession(input: Omit<Parameters<typeof createSharedClientGoalSession>[0], 'api' | 'cancellation'> & { api: ClientGoalApi }) {
  const abort = new AbortController();
  const api: SharedClientGoalApi = {
    readHost: () => input.api.readHost(abort.signal),
    prepareGoal: value => input.api.prepareGoal(value, abort.signal),
    readGoalPreparation: value => input.api.readGoalPreparation(value, abort.signal),
    readGoalCandidates: value => input.api.readGoalCandidates(value, abort.signal),
    prepareGoalQuote: value => input.api.prepareGoalQuote(value, abort.signal),
    readGoalQuotePreparation: value => input.api.readGoalQuotePreparation(value, abort.signal),
    confirmQuoteParameters: value => input.api.confirmQuoteParameters(value, abort.signal),
    readQuoteOriginal: value => input.api.readQuoteOriginal(value, abort.signal),
    readCatalog: () => input.api.readCatalog(abort.signal),
    readEnterprisePolicies: () => input.api.readEnterprisePolicies(abort.signal),
    readAddresses: () => input.api.readAddresses(abort.signal),
    createTask: value => input.api.createTask(value, abort.signal),
    readCreation: value => input.api.readCreation(value, abort.signal),
    readSnapshot: value => input.api.readSnapshot(value, abort.signal),
    startModel: value => input.api.startModel(value, abort.signal),
    readModelResult: value => input.api.readModelResult(value, abort.signal),
    readInput: value => input.api.readInput(value, abort.signal),
    submitInput: value => input.api.submitInput(value, abort.signal),
    readInputReceipt: value => input.api.readInputReceipt(value, abort.signal),
    continueInput: value => input.api.continueInput(value, abort.signal),
  };
  return createSharedClientGoalSession({ ...input, api,
    cancellation: { signal: abort.signal, cancel: () => abort.abort() } });
}

/** The original quote carries all Core-normalized pricing/usage and enterprise
 * disclosure. Booking selection binds its ID and explicitly chosen conditions;
 * this conversion never re-quotes or supplies a missing business default. */
export function clientGoalBookingSelection(source: ClientGoalBookingSource) {
  const { selection, quote, timeZone } = source;
  if (!selection.bookingIdentity?.bookingIdentity || !quote.quoteId) throw Error('client_goal_booking_source_unavailable');
  return aiBookingSelectionSchema.parse({ quoteId: quote.quoteId, timeZone, startAt: selection.startAt, endAt: selection.endAt,
    fulfillmentMode: selection.fulfillmentMode, fulfillmentLocationId: selection.fulfillmentLocationId,
    ...(selection.returnLocationId ? { returnLocationId: selection.returnLocationId } : {}),
    ...(selection.deliveryAddressId ? { deliveryAddressId: selection.deliveryAddressId } : {}),
    bookingIdentity: { bookingIdentity: selection.bookingIdentity.bookingIdentity,
      ...(selection.bookingIdentity.corporateCustomerId ? { corporateCustomerId: selection.bookingIdentity.corporateCustomerId } : {}),
      enterpriseContractAndPayer: selection.bookingIdentity.enterpriseContractAndPayer === true },
    lines: selection.lines.map(line => { if (!line.itemGroupId) throw Error('client_goal_booking_item_unavailable');
      return { itemGroupId: line.itemGroupId, quantity: line.quantity }; }),
    ...(selection.services?.length ? { services: selection.services } : {}) });
}

export function clientGoalBookingStorageKey(context: Parameters<typeof goalStorageKey>[0], original: ClientGoalBookingSource['original']) {
  const reference = aiClientQuoteConfirmationRequestSchema.parse(original);
  return `${goalStorageKey(context)}:booking:${reference.materialRef}`;
}
export { createClientQuoteBookingSession as createClientGoalBookingSession, clientQuoteBookingStoredRequest as clientGoalBookingStoredRequest };
