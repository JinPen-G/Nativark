/** 原员工宿主供给同一会话、运输、权限和原 Native Action 校验。 */
import { createRentalStaffEntryActionApi } from "@rental-os/rental-core/clients/staff";
import {
  AI_REGISTERED_ENTRY_ACTION_VERSION,
  AI_REGISTERED_ENTRY_ACTION_HTTP,
  aiRegisteredEntryActionOrderSourceSchema,
  aiRegisteredEntryActionOrderResponseSchema,
  aiRegisteredEntryActionReadSchema,
  aiRegisteredEntryActionRevalidationSchema,
} from "../components/ai-native/entry-action-runtime";
import { request } from "../core/http";
import { contextVersion, currentSession, can } from "../core/session";
import { serverNow } from "../core/clock";
export const { captureStaffEntryActionContext, createStaffEntryActionApi } = createRentalStaffEntryActionApi({
  request,
  currentSession,
  contextVersion,
  serverNow,
  can,
  contracts: {
    AI_REGISTERED_ENTRY_ACTION_VERSION,
    AI_REGISTERED_ENTRY_ACTION_HTTP,
    aiRegisteredEntryActionOrderSourceSchema,
    aiRegisteredEntryActionOrderResponseSchema,
    aiRegisteredEntryActionReadSchema,
    aiRegisteredEntryActionRevalidationSchema,
  },
});
export {
  STAFF_ORDER_ENTRY_CODES,
  type StaffOrderEntryCode,
  type StaffEntryActionApi,
} from "@rental-os/rental-core/clients/staff";
