/** 原客户宿主适配，供给同一运输、Native 合同与生命周期。 */
import { createRentalMiniProgramGoalApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "../core/http";
import { clientTaskApi } from "./ai-tasks";
import {
  AI_CLIENT_ENTRY_HTTP_DRAFT,
  aiClientHostCapabilitiesSchema,
  aiClientGoalPreparationRequestSchema,
  aiClientGoalPreparationReadRequestSchema,
  aiClientGoalPreparationResponseSchema,
  aiClientGoalCandidatesRequestSchema,
  aiClientGoalProjectionSchema,
  aiClientGoalQuoteRequestSchema,
  aiClientGoalQuoteReferenceSchema,
  aiClientGoalQuoteReadResponseSchema,
  aiClientQuotePreparationResponseSchema,
  aiClientQuoteConfirmationRequestSchema,
  aiClientQuoteResultReadResponseSchema,
} from "../vendor/shared-ai-client";
export function createClientGoalApi(current: () => boolean): ClientGoalApi {
  return createRentalMiniProgramGoalApi(
    {
      request,
      contracts: {
        AI_CLIENT_ENTRY_HTTP_DRAFT,
        aiClientHostCapabilitiesSchema,
        aiClientGoalPreparationRequestSchema,
        aiClientGoalPreparationReadRequestSchema,
        aiClientGoalPreparationResponseSchema,
        aiClientGoalCandidatesRequestSchema,
        aiClientGoalProjectionSchema,
        aiClientGoalQuoteRequestSchema,
        aiClientGoalQuoteReferenceSchema,
        aiClientGoalQuoteReadResponseSchema,
        aiClientQuotePreparationResponseSchema,
        aiClientQuoteConfirmationRequestSchema,
        aiClientQuoteResultReadResponseSchema,
      },
      clientTaskApi,
    },
    current,
  );
}
import type { ClientGoalApi } from "@rental-os/shared";
