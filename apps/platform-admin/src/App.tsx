/** 默认空Core组合。其他宿主提供已验证注册表即可复用同一应用，不改公共内部路由。 */
import { ADMIN_BRAND_NAME, AdminBrandMark } from "@rental-os/platform-admin/shell";
import { createPlatformAdminApplication } from "@rental-os/platform-admin/application";
import type { ComponentType } from "react";
import { session } from "./session";

export function createPublicAdminApp(platformAiPage?: ComponentType, tenantAiPage?: ComponentType) {
  return createPlatformAdminApplication({ brandName: ADMIN_BRAND_NAME, brand: <AdminBrandMark />, session, platformAiPage, tenantAiPage });
}
