/** 原HTTP会话消费公共订阅客户端，保留既有API方法与响应约定。 */
import { createSubscriptionClient } from "@rental-os/platform-admin/subscription/client";
import { request } from "./http";
export type { PlatformSubscriptionListQuery, PlatformSubscriptionList } from "@rental-os/platform-admin/subscription/client";
export const subscriptionApi = createSubscriptionClient(request);
