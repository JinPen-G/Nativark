import { z } from 'zod';
import type { composeRequestBoundClientApplication, AiClientApplicationRequest } from './client-request.application';
import { AiClientEntryError, entryId, parseEntry } from './client-entry-action';
import { AiClientMaterialError } from './prisma-client-scene-material.repository';
import { bookingSelectionSchema, oneTimeQuoteSnapshotFingerprint } from './client-booking-material';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { aiClientQuoteConfirmationRequestSchema } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

type Application = ReturnType<typeof composeRequestBoundClientApplication>;
const commandSchema = z.object({ original: aiClientQuoteConfirmationRequestSchema,
  selection: bookingSelectionSchema, operationKey: entryId }).strict();

/** Human server-host consumer of the original quote and existing booking flow.
 * Not a model tool, HTTP contract or executor. Selection/approval never follows
 * automatically from a quote, and observation never creates another quote. */
export function composeClientOriginalBookingFlow(application: Application) {
  const resolve = async (request: AiClientApplicationRequest, command: z.infer<typeof commandSchema>) => {
    const read = await application.readPreparedQuoteBookingMaterial(request, command.original, command.selection);
    if (read.state !== 'observed') return { read, operation: null };
    return { read, operation: { operationKey: command.operationKey,
      command: { kind: 'booking_quote' as const, selection: read.material.selection } } };
  };
  return Object.freeze({
    async prepare(request: AiClientApplicationRequest, value: unknown) {
      const command = freezeOriginalInput(parseEntry(commandSchema, structuredClone(value)));
      const currentRequest = freezeOriginalInput(structuredClone(request));
      const before = await resolve(currentRequest, command);
      if (!before.operation) return before.read;
      // Existing material persistence uses an exact operation key/hash and
      // current independent client policy. No draft/choice/approval is created.
      const material = await application.prepare(currentRequest, before.operation);
      try {
        const after = await resolve(currentRequest, command);
        if (!after.operation || requestFingerprint(after.read) !== requestFingerprint(before.read)) {
          throw new AiClientMaterialError('AI_CLIENT_RESULT_UNKNOWN');
        }
        const action = await application.issueAction(currentRequest,
          { actionCode: 'CREATE_BOOKING_DRAFT', materialRef: material.materialRef });
        return freezeOriginalInput({ originalQuote: before.read.source, material, action,
          draft: 'not_created' as const, humanSelection: 'required_before_handoff' as const,
          pageAcceptance: 'not_attempted' as const, orderExecution: 'not_attempted' as const });
      } catch {
        // Persistence succeeded; a later failure cannot authorize a second preparation.
        throw new AiClientMaterialError('AI_CLIENT_RESULT_UNKNOWN');
      }
    },
    async readOperation(request: AiClientApplicationRequest, value: unknown) {
      const command = freezeOriginalInput(parseEntry(commandSchema, structuredClone(value)));
      const currentRequest = freezeOriginalInput(structuredClone(request));
      const original = await application.readPreparedQuoteOriginal(currentRequest, command.original);
      if (original.state !== 'observed' || !original.quote) return freezeOriginalInput({
        source: original.source, state: 'unknown' as const, material: null,
        quotePersistence: 'unknown' as const, retryable: false as const,
        nextAction: 'read_original_quote' as const, inventoryReservation: 'not_attempted' as const,
        orderExecution: 'not_attempted' as const });
      const quote = original.quote, selection = command.selection, membership = quote.membershipSnapshot;
      if (quote.id !== selection.quoteId) throw new AiClientEntryError('AI_ACCESS_DENIED', 'quote_original_selection_mismatch');
      // Historical association only: compare the caller's explicit original
      // confirmation, never reopen today's service area or address book here.
      const snapshot = quote.deliveryAddressSnapshot;
      if (quote.request.deliveryAddressDraft && (!snapshot || quote.request.deliveryAddressId || snapshot.addressId))
        throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'original_one_time_quote_address_basis_missing');
      const addressConfirmation = quote.request.deliveryAddressDraft && snapshot ? {
        source: 'original_quote_one_time_address' as const, snapshotFingerprint: oneTimeQuoteSnapshotFingerprint(snapshot), confirmed: true as const
      } : undefined;
      // Begin original Core service history normalization.
      // Preparation persisted Core-normalized occurrences, not the caller's
      // omitted optional fields. Rebuild only from the SAME immutable quote;
      // service/quantity remain explicit, and no current capacity/config is read.
      let originalServices = quote.request.services ?? [], expectedServices = selection.services ?? [], receiptSelection = selection;
      const hasServices = Boolean(quote.serviceSnapshots?.length || quote.request.services?.length || selection.services?.length);
      if (hasServices) {
        if (!Array.isArray(quote.serviceSnapshots) || !quote.serviceSnapshots.length || quote.serviceSnapshots.length > 20
          || quote.serviceSnapshots.some(row => typeof row.scheduledStartAt !== 'string' || typeof row.scheduledEndAt !== 'string'
            || typeof row.serviceLocationId !== 'string'))
          throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'original_quote_service_occurrences_missing');
        if (!selection.services?.length) throw new AiClientEntryError('AI_INVALID_INPUT', 'confirm_original_quote_services', 'clarify');
        originalServices = quote.serviceSnapshots.map(row => ({ serviceId: row.serviceId, quantity: row.quantity,
          scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt, serviceLocationId: row.serviceLocationId }));
        const supplied = selection.services.map(row => ({ ...row, scheduledStartAt: row.scheduledStartAt ?? quote.request.startAt,
          scheduledEndAt: row.scheduledEndAt ?? quote.request.endAt, serviceLocationId: row.serviceLocationId ?? quote.request.fulfillmentLocationId }));
        const serviceKeys = (rows: typeof originalServices) => rows.map(row => requestFingerprint(JSON.parse(JSON.stringify(row)))).sort();
        if (requestFingerprint(serviceKeys(supplied)) !== requestFingerprint(serviceKeys(originalServices)))
          throw new AiClientEntryError('AI_REVISION_CONFLICT', 'quote_original_service_selection_mismatch');
        expectedServices = originalServices;
        receiptSelection = parseEntry(bookingSelectionSchema, { ...selection, services: originalServices,
          returnLocationId: selection.returnLocationId ?? quote.request.returnLocationId ?? quote.request.fulfillmentLocationId });
      }
      // End original Core service history normalization.
      const recorded = bookingSelectionSchema.safeParse({ quoteId: quote.id, timeZone: quote.pricingContext?.timeZone,
        startAt: quote.request.startAt, endAt: quote.request.endAt,
        fulfillmentMode: quote.request.fulfillmentMode, fulfillmentLocationId: quote.request.fulfillmentLocationId,
        returnLocationId: quote.request.returnLocationId ?? quote.request.fulfillmentLocationId,
        deliveryAddressId: quote.request.deliveryAddressId, ...(addressConfirmation ? { deliveryAddressConfirmation: addressConfirmation } : {}), services: originalServices,
        lines: quote.request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })),
        bookingIdentity: membership && { bookingIdentity: membership.bookingIdentity,
          ...(membership.corporateCustomerId ? { corporateCustomerId: membership.corporateCustomerId } : {}),
          enterpriseContractAndPayer: membership.enterpriseContractAndPayer } });
      if (!recorded.success) {
        throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'original_quote_selection_basis_missing');
      }
      const expected = { ...selection, services: expectedServices,
        returnLocationId: selection.returnLocationId ?? recorded.data.returnLocationId };
      const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
      if (hash(recorded.data) !== hash(expected)) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'quote_original_selection_mismatch');
      const receipt = await application.readBookingMaterialReceipt(currentRequest, { operationKey: command.operationKey,
        command: { kind: 'booking_quote', selection: receiptSelection } });
      const latest = await application.readPreparedQuoteOriginal(currentRequest, command.original);
      if (latest.state !== 'observed' || hash(latest) !== hash(original)) {
        throw new AiClientEntryError('AI_REVISION_CONFLICT', 'quote_original_changed');
      }
      return freezeOriginalInput(receipt);
    },
    /** The original page acceptance and business receipt remain separate from
     * draft handoff. These are the real existing independently guarded methods. */
    readCurrentMaterial: application.readSource.bind(application),
    readPagePreparation: application.readBookingPreparation.bind(application),
    readPageAcceptance: application.readBookingAcceptance.bind(application),
    acceptPage: application.acceptBookingSubmission.bind(application),
    submitPage: application.submitAcceptedBooking.bind(application),
    readSubmission: application.readBookingSubmission.bind(application),
    readDraftOperation: application.readBookingOperation.bind(application),
    // Versioned minimal observation; preserve the original receipt consumer.
    // Expired/terminal metadata does not revive a page Action or old material.
    readDraftObservation: application.readBookingOperationObservation.bind(application)
  });
}
