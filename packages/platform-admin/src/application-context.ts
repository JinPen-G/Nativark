/** 公共应用组合依赖，只由宿主提供；业务Core不创建第二个会话或修改公共路由内部判断。 */
import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { CoreRegisteredPage, CoreScopeReference } from "@rental-os/core-contracts";
import type { CoreRouteComponent } from "./core/CoreRoutes";
import type { createBrowserAdminSession } from "./runtime/browser-session";
import type { PlatformShellProps } from "./PlatformShell";
import type { AdminLoginDisplay } from "./session-pages";
import type { PublicManagementCoreAdapter } from "./features/access/management-adapter";
import type { AdminMessages } from "./app/locale";

export interface PlatformAdminApplicationOptions {
  brandName: string;
  brand: ReactNode;
  /** 原登录展示的可选宿主端口，不赋予租户或 Core 权限。 */
  loginDisplay?: AdminLoginDisplay;
  /** 宿主合并 Core 词条，沿同一语言上下文呈现。 */
  messages?: AdminMessages;
  /** 所选 Core 对原账号/租户页提供业务内容；公共权限与会话仍由同一宿主裁定。 */
  management?: PublicManagementCoreAdapter;
  /** 显式选用的原平台模型配置页；入口仍受同一 SaaS 权限限制。 */
  platformAiPage?: ComponentType;
  /** 原公共页面的领域文案由 Core 提供，不改变路由、权限或数据范围。 */
  publicPageContent?: {
    subscription?: { description?: string };
    subscriptionPro?: { standardDescription?: string };
    dispatch?: { description?: string; businessScopeLabel?: string };
    operatorInvitation?: { invitationTitle?: string; businessScopeLabel?: string };
  };
  session: ReturnType<typeof createBrowserAdminSession>;
  pages?: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>>;
  /** 首选的已登记业务入口；未获权时仍从当前可用集合定位，不把偏好作为授权。 */
  initialPage?: { coreId: string; pageId: string };
  /** 原登录响应明确需要初始化时优先进入此已获权登记页。 */
  onboardingPage?: { coreId: string; pageId: string };
  /** 宿主向同一公共外壳供给业务上下文、通知和详情。 */
  Shell?: ComponentType<PlatformShellProps>;
  /** 当前已验证业务投影；变化时调用同一 session.invalidateBusinessScope，使旧请求和页面失效。 */
  getCoreContainer?: (coreId: string, pageId: string) => CoreScopeReference["container"];
}
export const PlatformApplicationContext = createContext<PlatformAdminApplicationOptions | null>(null);
export function usePlatformApplication() {
  const value = useContext(PlatformApplicationContext);
  if (!value) throw new Error("公共应用必须由正式组合入口创建");
  return value;
}
