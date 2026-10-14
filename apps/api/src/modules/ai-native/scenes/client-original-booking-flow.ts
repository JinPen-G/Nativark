import { z } from 'zod';
import type { composeRequestBoundClientApplication, AiClientApplicationRequest } from './client-request.application';
import { entryId, parseEntry } from './client-entry-action';
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
      const after = await resolve(currentRequest, command);
      if (!after.operation || requestFingerprint(after.read) !== requestFingerprint(before.read)) {
        throw new AiClientMaterialError('AI_CLIENT_RESULT_UNKNOWN');
      }
      const action = await application.issueAction(currentRequest,
        { actionCode: 'CREATE_BOOKING_DRAFT', materialRef: material.materialRef });
      return freezeOriginalInput({ originalQuote: before.read.source, material, action,
        draft: 'not_created' as const, humanSelection: 'required_before_handoff' as const,
        pageAcceptance: 'not_attempted' as const, orderExecution: 'not_attempted' as const });
    },
    async readOperation(request: AiClientApplicationRequest, value: unknown) {
      const command = freezeOriginalInput(parseEntry(commandSchema, structuredClone(value)));
      const currentRequest = freezeOriginalInput(structuredClone(request));
      const source = await resolve(currentRequest, command);
      if (!source.operation) return source.read;
      // Absence stays unknown. This cannot fall through to prepare/create.
      return application.readOperation(currentRequest, source.operation);
    },
    /** The original page acceptance and business receipt remain separate from
     * draft handoff. These are the real existing independently guarded methods. */
    readPagePreparation: application.readBookingPreparation.bind(application),
    acceptPage: application.acceptBookingSubmission.bind(application),
    readSubmission: application.readBookingSubmission.bind(application),
    readDraftOperation: application.readBookingOperation.bind(application)
  });
}
