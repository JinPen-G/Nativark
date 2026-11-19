/** 客户原 API 适配，同一 request 与 Native 校验器供给 Rental 工厂。 */
import { createRentalMiniProgramTaskApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "../core/http";
import {
  AI_CLIENT_ENTRY_HTTP_DRAFT,
  aiClientOrderMaterialRequestSchema,
  aiClientOrderMaterialReceiptSchema,
  aiClientTaskReadRequestSchema,
  aiClientTaskCreationReceiptSchema,
  aiClientTaskModelControlResponseSchema,
  aiClientTaskModelResultReadResponseSchema,
  aiClientTaskInputReadResponseSchema,
  aiClientTaskInputSubmissionRequestSchema,
  aiClientTaskInputReferenceRequestSchema,
  aiClientTaskInputSubmissionReceiptSchema,
  aiClientTaskInputReceiptReadResponseSchema,
  aiClientTaskEventsReadRequestSchema,
  aiClientTaskSnapshotReadResponseSchema,
  aiClientTaskEventsReadResponseSchema,
  aiClientOrderActionSourceSchema,
  aiClientOrderActionSchema,
  aiClientOrderActionRevalidationSchema,
  aiClientHostCapabilitiesSchema,
} from "../vendor/shared-ai-client";
export const clientTaskApi = createRentalMiniProgramTaskApi({
  request,
  contracts: {
    AI_CLIENT_ENTRY_HTTP_DRAFT,
    aiClientOrderMaterialRequestSchema,
    aiClientOrderMaterialReceiptSchema,
    aiClientTaskReadRequestSchema,
    aiClientTaskCreationReceiptSchema,
    aiClientTaskModelControlResponseSchema,
    aiClientTaskModelResultReadResponseSchema,
    aiClientTaskInputReadResponseSchema,
    aiClientTaskInputSubmissionRequestSchema,
    aiClientTaskInputReferenceRequestSchema,
    aiClientTaskInputSubmissionReceiptSchema,
    aiClientTaskInputReceiptReadResponseSchema,
    aiClientTaskEventsReadRequestSchema,
    aiClientTaskSnapshotReadResponseSchema,
    aiClientTaskEventsReadResponseSchema,
    aiClientOrderActionSourceSchema,
    aiClientOrderActionSchema,
    aiClientOrderActionRevalidationSchema,
    aiClientHostCapabilitiesSchema,
  },
});
export type { ClientTaskApi, ClientOrderNavigationPort } from "@rental-os/rental-core/clients/miniprogram";
