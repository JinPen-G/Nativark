/** 原 Rental API 名称复用公共请求工厂和宿主唯一会话客户端。 */
import { createOperatorInvitationApi, createTenantMessagingApi, createTenantSupportApi } from "@rental-os/platform-admin/messaging";
import { request } from "./http";

export const tenantMessagingApi = createTenantMessagingApi(request);
export const tenantSupportApi = createTenantSupportApi(request);
export const operatorInvitationApi = createOperatorInvitationApi(import.meta.env.VITE_API_BASE_URL ?? "/api");
