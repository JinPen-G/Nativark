/** 客户原 API 适配，同一 request 与 Native 校验器供给 Rental 工厂。 */
import { createRentalMiniProgramTaskCancellationApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "../core/http";
import {
  AI_CLIENT_ENTRY_HTTP_DRAFT,
  aiClientTaskCancelRequestSchema,
  aiClientTaskCancelReceiptSchema,
  aiClientTaskCancellationObservationSchema,
  aiClientTaskInputCancellationReceiptSchema,
  aiClientTaskUnstartedCancellationReceiptSchema,
  aiClientTaskReadRequestSchema,
} from "../vendor/shared-ai-client";
import { clientTaskApi } from "./ai-tasks";
export const clientTaskCancellationApi = createRentalMiniProgramTaskCancellationApi({
  request,
  contracts: {
    AI_CLIENT_ENTRY_HTTP_DRAFT,
    aiClientTaskCancelRequestSchema,
    aiClientTaskCancelReceiptSchema,
    aiClientTaskCancellationObservationSchema,
    aiClientTaskInputCancellationReceiptSchema,
    aiClientTaskUnstartedCancellationReceiptSchema,
    aiClientTaskReadRequestSchema,
  },
  clientTaskApi,
});
export type { ClientTaskCancellationApi } from "@rental-os/rental-core/clients/miniprogram";
