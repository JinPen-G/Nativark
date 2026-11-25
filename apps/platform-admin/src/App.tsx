/** 默认空Core组合。其他宿主提供已验证注册表即可复用同一应用，不改公共内部路由。 */
import { AdminBrandMark } from "@rental-os/platform-admin/shell";
import { createPlatformAdminApplication } from "@rental-os/platform-admin/application";
import { session } from "./session";

export const PlatformAdminApp = createPlatformAdminApplication({ brandName: "Nativark", brand: <AdminBrandMark />, session });
