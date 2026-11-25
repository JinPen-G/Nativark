/** 原客户宿主适配，供给同一运输、Native 合同与生命周期。 */
import { createRentalMiniProgramBookingTransferApi } from "@rental-os/rental-core/clients/miniprogram";
import {
  AI_CLIENT_ENTRY_HTTP_DRAFT,
  aiClientHostCapabilitiesSchema,
  aiClientBookingTransferIssueRequestSchema,
  aiClientBookingTransferRequestSchema,
  aiClientBookingTransferIssueResponseSchema,
  aiClientBookingTransferReceiptSchema,
} from "../vendor/shared-ai-client";
import { request } from "../core/http";
export function createClientBookingTransferApi(context: { current(): boolean }): ClientBookingTransferApi {
  return createRentalMiniProgramBookingTransferApi(
    {
      request,
      contracts: {
        AI_CLIENT_ENTRY_HTTP_DRAFT,
        aiClientHostCapabilitiesSchema,
        aiClientBookingTransferIssueRequestSchema,
        aiClientBookingTransferRequestSchema,
        aiClientBookingTransferIssueResponseSchema,
        aiClientBookingTransferReceiptSchema,
      },
    },
    context,
  );
}
export type { ClientBookingTransferApi } from "@rental-os/rental-core/clients/miniprogram";
import type { ClientBookingTransferApi } from "@rental-os/rental-core/clients/miniprogram";
