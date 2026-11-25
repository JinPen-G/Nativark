/** 原客户宿主供给同一会话、运输、权限和原 Native Action 校验。 */
import { createRentalMiniProgramEntryActionApi } from "@rental-os/rental-core/clients/miniprogram";
import {
  AI_REGISTERED_ENTRY_ACTION_VERSION,
  AI_REGISTERED_ENTRY_ACTION_HTTP,
  aiRegisteredEntryActionOrderSourceSchema,
  aiRegisteredEntryActionOrderResponseSchema,
  aiRegisteredEntryActionReadSchema,
  aiRegisteredEntryActionRevalidationSchema,
} from "../components/ai-native/entry-action-runtime";
import { request } from "../core/http";
import { currentSession, contextVersion } from "../core/session";
import { PUBLIC_CONFIG } from "../config/public";
import { serverNow } from "../core/clock";
export const { captureClientEntryActionContext, createClientEntryActionApi } = createRentalMiniProgramEntryActionApi({
  request,
  currentSession,
  contextVersion,
  serverNow,
  publicConfig: PUBLIC_CONFIG,
  contracts: {
    AI_REGISTERED_ENTRY_ACTION_VERSION,
    AI_REGISTERED_ENTRY_ACTION_HTTP,
    aiRegisteredEntryActionOrderSourceSchema,
    aiRegisteredEntryActionOrderResponseSchema,
    aiRegisteredEntryActionReadSchema,
    aiRegisteredEntryActionRevalidationSchema,
  },
});
export type { ClientOriginalPaymentRecord } from "@rental-os/rental-core/clients/miniprogram";
