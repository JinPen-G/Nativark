import { z } from 'zod';
import type { composeRequestBoundClientApplication, AiClientApplicationRequest } from './client-request.application';
import { AiClientEntryError, entryId, parseEntry } from './client-entry-action';
import { AiClientMaterialError } from './prisma-client-scene-material.repository';
import { bookingSelectionSchema } from './client-booking-material';
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
      const recorded = bookingSelectionSchema.safeParse({ quoteId: quote.id, timeZone: quote.pricingContext?.timeZone,
        startAt: quote.request.startAt, endAt: quote.request.endAt,
        fulfillmentMode: quote.request.fulfillmentMode, fulfillmentLocationId: quote.request.fulfillmentLocationId,
        returnLocationId: quote.request.returnLocationId ?? quote.request.fulfillmentLocationId,
        deliveryAddressId: quote.request.deliveryAddressId, services: quote.request.services ?? [],
        lines: quote.request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })),
        bookingIdentity: membership && { bookingIdentity: membership.bookingIdentity,
          ...(membership.corporateCustomerId ? { corporateCustomerId: membership.corporateCustomerId } : {}),
          enterpriseContractAndPayer: membership.enterpriseContractAndPayer } });
      if (!recorded.success || quote.request.deliveryAddressDraft) {
        throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'original_quote_selection_basis_missing');
      }
      const expected = { ...selection, services: selection.services ?? [],
        returnLocationId: selection.returnLocationId ?? recorded.data.returnLocationId };
      const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
      if (hash(recorded.data) !== hash(expected)) throw new AiClientEntryError('AI_REVISION_CONFLICT', 'quote_original_selection_mismatch');
      const receipt = await application.readBookingMaterialReceipt(currentRequest, { operationKey: command.operationKey,
        command: { kind: 'booking_quote', selection } });
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
    readDraftOperation: application.readBookingOperation.bind(application)
  });
}
