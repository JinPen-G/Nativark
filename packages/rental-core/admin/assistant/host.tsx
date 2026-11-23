/** 原 Agent/Copilot 消费同一 Rental 会话及当前登记导航；不创建认证、业务授权或执行驱动。 */
import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { useLocation as useRouterLocation, useNavigate as useRouterNavigate, type NavigateOptions } from "react-router-dom";
import { AiAdminHostProvider, createAiAdminHost } from "@rental-os/ai-native-admin/host";
import { createAiTaskCenterApi } from "@rental-os/ai-native-admin/source/api/aiTaskCenter";
import type { RentalBrowserAdminSession } from "../browser";
import { createAiConversationsApi } from "./api/aiConversations";
import { createAiQuoteSelectionsApi } from "./api/aiQuoteSelections";
import { createAiWorkbenchDisplaysApi } from "./api/aiWorkbenchDisplays";
import { createAiTaskOrderHandoffApi } from "./api/aiTaskOrderHandoff";
import { createAiEntryActionsApi } from "./api/aiEntryActions";

export interface RentalAssistantRoute { path: string; label: string; permission: string; menu?: boolean }
export interface RentalAssistantNavigation {
  /** 保留完整原页面标识和原路径；宿主未登记或已撤权的页面由 canAccess 拒绝。 */
  routes: Record<string, RentalAssistantRoute>;
  canAccess(route: RentalAssistantRoute): boolean;
  /** 将原深链接定位到当前已登记且获权的宿主路径；失败返回 null。 */
  resolve(href: string): string | null;
  /** 当前登记路径的原页面路径，供原上下文、锚点及会话可见性判定。 */
  originalPath(pathname: string): string | null;
}
export interface RentalAssistantOptions {
  session: RentalBrowserAdminSession;
  useNavigation(): RentalAssistantNavigation;
}

export function createRentalAssistantContext(options: RentalAssistantOptions) {
  const { session, useNavigation } = options;
  if (typeof session?.useAuthStore !== "function" || typeof useNavigation !== "function")
    throw new Error("Agent 与 Copilot 需要原 Rental 会话和当前登记导航");
  const aiHost = createAiAdminHost({ runtime: session.runtime, getSession: () => {
    const auth = session.useAuthStore.getState();
    return { sessionVerified: auth.sessionVerified, authenticated: Boolean(auth.token), tenant: auth.tenant,
      user: auth.user, currentWorkspaceId: auth.currentWorkspaceId, hasPermission: auth.hasPermission };
  } });
  const transport = { session, aiHost };
  return Object.freeze({ session, useNavigation, aiHost,
    aiTaskCenterApi: createAiTaskCenterApi(session.runtime),
    aiConversationsApi: createAiConversationsApi(transport),
    aiQuoteSelectionsApi: createAiQuoteSelectionsApi(transport),
    createAiWorkbenchDisplayPort: createAiWorkbenchDisplaysApi(transport),
    aiTaskOrderHandoffApi: createAiTaskOrderHandoffApi(transport),
    aiEntryActionsApi: createAiEntryActionsApi(transport),
  });
}

export type RentalAssistantContext = ReturnType<typeof createRentalAssistantContext>;
export type RentalAssistantSession = ReturnType<RentalBrowserAdminSession["useAuthStore"]["getState"]>;
const Context = createContext<RentalAssistantContext | null>(null);
export function RentalAssistantHost({ value, children }: { value: RentalAssistantContext; children: ReactNode }) {
  return <AiAdminHostProvider host={value.aiHost}><Context.Provider value={value}>{children}</Context.Provider></AiAdminHostProvider>;
}
export function useRentalAssistantContext() {
  const context = useContext(Context);
  if (!context) throw new Error("Agent 与 Copilot 必须绑定当前 Rental 宿主");
  return context;
}
export function useRentalAssistant() {
  const context = useRentalAssistantContext(), navigation = context.useNavigation();
  const current = useRef(navigation); current.current = navigation;
  // 异步原收据读取会保留此检查函数；Core 菜单变化不一定改变登录代次。
  const canAccessRoute = useCallback((route: RentalAssistantRoute, ..._originalProjection: unknown[]) =>
    Boolean(route && current.current.canAccess(route)), []);
  return { ...context, ...context.session, APP_ROUTES: navigation.routes,
    canAccessRoute };
}

export function useLocation() {
  const location = useRouterLocation(), context = useRentalAssistantContext(), navigation = context.useNavigation();
  return { ...location, pathname: navigation.originalPath(location.pathname) ?? location.pathname };
}

/** 原页面只导航到宿主已登记且当前获权的目标；原状态与查询参数继续传给同一路由。 */
export function useNavigate() {
  const navigate = useRouterNavigate(), context = useRentalAssistantContext(), navigation = context.useNavigation();
  const current = useRef(navigation); current.current = navigation;
  return useCallback((href: string, options?: NavigateOptions) => {
    const target = current.current.resolve(href);
    if (!target) throw new Error("AI_ACCESS_DENIED");
    return navigate(target, options);
  }, [navigate]);
}
