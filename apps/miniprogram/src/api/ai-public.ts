/** 原客户宿主适配，供给同一运输、Native 合同与生命周期。 */
import { createRentalMiniProgramPublicApi } from "@rental-os/rental-core/clients/miniprogram";
import {
  AI_CLIENT_PUBLIC_HTTP,
  aiClientPublicSessionRequestSchema,
  aiClientPublicReadRequestSchema,
  aiClientPublicPreparationRequestSchema,
  aiClientPublicOperationRequestSchema,
  aiClientPublicContinuationRequestSchema,
  aiClientPublicContinuationReadRequestSchema,
  aiClientPublicSessionResponseSchema,
  aiClientPublicReadResponseSchema,
  aiClientPublicPreparationResponseSchema,
  aiClientPublicOperationResponseSchema,
  aiClientPublicContinuationResponseSchema,
} from "../vendor/shared-ai-client";
import { request } from "../core/http";
import { PUBLIC_CONFIG } from "../config/public";
export const clientPublicApi = createRentalMiniProgramPublicApi({
  request,
  contracts: {
    AI_CLIENT_PUBLIC_HTTP,
    aiClientPublicSessionRequestSchema,
    aiClientPublicReadRequestSchema,
    aiClientPublicPreparationRequestSchema,
    aiClientPublicOperationRequestSchema,
    aiClientPublicContinuationRequestSchema,
    aiClientPublicContinuationReadRequestSchema,
    aiClientPublicSessionResponseSchema,
    aiClientPublicReadResponseSchema,
    aiClientPublicPreparationResponseSchema,
    aiClientPublicOperationResponseSchema,
    aiClientPublicContinuationResponseSchema,
  },
  publicConfig: PUBLIC_CONFIG,
});
