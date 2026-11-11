/** Expose the existing original-quote booking consumer through closed public
 * projections. It neither creates another quote nor selects/accepts a draft.
 * Receipt reads expose only the original material locator, never an Action. */
import { AI_CLIENT_QUOTE_BOOKING_VERSION, aiClientQuoteBookingRequestSchema,
  aiClientQuoteBookingPreparationResponseSchema, aiClientQuoteBookingOperationResponseSchema,
  type AiClientQuoteBookingPreparationResponse, type AiClientQuoteBookingOperationResponse } from '@rental-os/shared';
import type { AiClientApplicationRequest, composeRequestBoundClientApplication } from './client-request.application';
import { composeClientOriginalBookingFlow } from './client-original-booking-flow';
import { AiClientMaterialError } from './prisma-client-scene-material.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';

export function composeClientOriginalBookingHttp(application: ReturnType<typeof composeRequestBoundClientApplication>) {
  const flow = composeClientOriginalBookingFlow(application);
  const currentRequest = (request: AiClientApplicationRequest): AiClientApplicationRequest => ({
    headers: { authorization: request?.headers?.authorization }, ...(request.ip ? { ip: request.ip } : {})
  });
  return Object.freeze({
    async prepareOriginalQuoteBooking(request: AiClientApplicationRequest, value: unknown, signal?: AbortSignal): Promise<AiClientQuoteBookingPreparationResponse> {
      if (signal?.aborted) throw new AiClientMaterialError('AI_CLIENT_RESULT_UNKNOWN');
      const command = aiClientQuoteBookingRequestSchema.parse(structuredClone(value));
      const result = await flow.prepare(currentRequest(request), command);
      if (signal?.aborted) throw new AiClientMaterialError('AI_CLIENT_RESULT_UNKNOWN');
      const base = { contractVersion: AI_CLIENT_QUOTE_BOOKING_VERSION, operationKey: command.operationKey,
        source: { materialRef: command.original.materialRef, materialHash: command.original.expectedMaterialHash },
        draft: 'not_created' as const, humanSelection: 'required_before_handoff' as const,
        pageAcceptance: 'not_attempted' as const, orderExecution: 'not_attempted' as const, retryable: false as const };
      if (!('action' in result)) {
        if (result.state !== 'unknown') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return aiClientQuoteBookingPreparationResponseSchema.parse({ ...base, state: 'unknown', material: null,
          action: null, nextAction: 'read_original_quote' });
      }
      // Any projection failure here follows the original material INSERT.
      // The caller must observe that operation, not attempt a fresh one.
      try {
        if (result.originalQuote.materialRef !== base.source.materialRef || result.originalQuote.materialHash !== base.source.materialHash
          || result.action.resource.id !== command.selection.quoteId || result.action.associations.quoteId !== command.selection.quoteId)
          throw new Error('Original quote binding mismatch');
        return aiClientQuoteBookingPreparationResponseSchema.parse({ ...base, state: 'prepared',
          material: { materialRef: result.material.materialRef, materialHash: result.material.materialHash,
            inputHash: result.material.inputHash, expiresAt: result.material.expiresAt }, action: result.action });
      } catch { throw new AiClientMaterialError('AI_CLIENT_RESULT_UNKNOWN'); }
    },
    async readOriginalQuoteBookingOperation(request: AiClientApplicationRequest, value: unknown, signal?: AbortSignal): Promise<AiClientQuoteBookingOperationResponse> {
      if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const command = aiClientQuoteBookingRequestSchema.parse(structuredClone(value)), result = await flow.readOperation(currentRequest(request), command);
      if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const base = { contractVersion: AI_CLIENT_QUOTE_BOOKING_VERSION, operationKey: command.operationKey,
        source: { materialRef: command.original.materialRef, materialHash: command.original.expectedMaterialHash },
        currentUse: 'not_authorized_by_receipt' as const, execution: 'not_attested' as const, retryable: false as const };
      if (result.state === 'unknown') return aiClientQuoteBookingOperationResponseSchema.parse({ ...base, state: 'unknown',
        material: null, nextAction: 'read_original_quote_booking_operation' });
      if (result.operationKey !== command.operationKey) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const parsed = aiClientQuoteBookingOperationResponseSchema.safeParse({ ...base, state: 'observed', material: {
        materialRef: result.materialRef, materialHash: result.materialHash, inputHash: result.inputHash,
        revision: result.revision, expiresAt: result.expiresAt, createdAt: result.createdAt,
        observedAt: result.observedAt, materialValidity: result.materialValidity }, nextAction: 'revalidate_material_before_action' });
      if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return parsed.data;
    }
  });
}
