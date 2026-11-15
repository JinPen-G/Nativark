/** 默认空Core组合。其他宿主提供已验证注册表即可复用同一应用，不改公共内部路由。 */
import { Blocks } from "lucide-react";
import { createPlatformAdminApplication } from "@rental-os/platform-admin/application";
import { session } from "./session";

export const PlatformAdminApp = createPlatformAdminApplication({ brandName: "Nativark", brand: <Blocks aria-hidden />, session });
