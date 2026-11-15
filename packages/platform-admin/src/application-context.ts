/** 公共应用组合依赖，只由宿主提供；业务Core不创建第二个会话或修改公共路由内部判断。 */
import { createContext, useContext, type ReactNode } from "react";
import type { CoreRegisteredPage } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "./core/CoreRoutes";
import type { createBrowserAdminSession } from "./runtime/browser-session";

export interface PlatformAdminApplicationOptions {
  brandName: string;
  brand: ReactNode;
  session: ReturnType<typeof createBrowserAdminSession>;
  pages?: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>>;
}
export const PlatformApplicationContext = createContext<PlatformAdminApplicationOptions | null>(null);
export function usePlatformApplication() {
  const value = useContext(PlatformApplicationContext);
  if (!value) throw new Error("公共应用必须由正式组合入口创建");
  return value;
}
