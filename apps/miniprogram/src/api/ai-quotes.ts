/** 客户原 API 适配，同一 request 与 Native 校验器供给 Rental 工厂。 */
import { createRentalMiniProgramQuoteApi } from "@rental-os/rental-core/clients/miniprogram";
import {
  AI_CLIENT_ENTRY_HTTP_DRAFT,
  aiClientBookingReadRequestSchema,
  aiClientQuoteReadRequestSchema,
  aiClientQuotePreparationRequestSchema,
  aiClientQuotePreparationResponseSchema,
  aiClientQuotePreparationReadResponseSchema,
  aiClientQuoteConfirmationRequestSchema,
  aiClientQuoteResultReadResponseSchema,
  aiClientQuoteBookingRequestSchema,
  aiClientQuoteBookingPreparationResponseSchema,
  aiClientQuoteBookingOperationResponseSchema,
  aiEntryActionSchema,
  aiBookingDraftSchema,
  aiBookingCreateResponseSchema,
  aiBookingChoiceResponseSchema,
  aiBookingHandoffResponseSchema,
  aiBookingOperationReadResponseSchema,
} from "../vendor/shared-ai-client";
import { request } from "../core/http";
export const clientQuoteApi = createRentalMiniProgramQuoteApi({
  request,
  contracts: {
    AI_CLIENT_ENTRY_HTTP_DRAFT,
    aiClientBookingReadRequestSchema,
    aiClientQuoteReadRequestSchema,
    aiClientQuotePreparationRequestSchema,
    aiClientQuotePreparationResponseSchema,
    aiClientQuotePreparationReadResponseSchema,
    aiClientQuoteConfirmationRequestSchema,
    aiClientQuoteResultReadResponseSchema,
    aiClientQuoteBookingRequestSchema,
    aiClientQuoteBookingPreparationResponseSchema,
    aiClientQuoteBookingOperationResponseSchema,
    aiEntryActionSchema,
    aiBookingDraftSchema,
    aiBookingCreateResponseSchema,
    aiBookingChoiceResponseSchema,
    aiBookingHandoffResponseSchema,
    aiBookingOperationReadResponseSchema,
  },
});
