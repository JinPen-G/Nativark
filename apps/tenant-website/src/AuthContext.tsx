import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSite } from './SiteContext';
import {
  authApi, configureAuthBridge, loadSession, sessionApi, subscribeCustomerSession,
  type ClientSession, type WorkspaceRef,
} from './data/authClient';

interface AuthContextValue {
  /** 当前登录会话；未登录为 null。演示模式恒为 null（无后端可登录）。 */
  session: ClientSession | null;
  isAuthenticated: boolean;
  customerName: string | null;
  workspaces: WorkspaceRef[];
  currentWorkspace: WorkspaceRef | null;
  /** 切换当前会话所在经营空间（下单/报价按当前空间计价）。 */
  switchWorkspace: (workspaceCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { tenantCode } = useSite();
  const [session, setSessionState] = useState<ClientSession | null>(() => (tenantCode ? loadSession(tenantCode) : null));
  // 只订阅协调器已提交的会话，不将迟到的页面响应重新写入 storage。
  const sessionRef = useRef<ClientSession | null>(session);
  sessionRef.current = session;

  useEffect(() => {
    if (!tenantCode) {
      sessionRef.current = null; setSessionState(null); configureAuthBridge(null);
      return;
    }
    const changed = () => {
      const next = loadSession(tenantCode); sessionRef.current = next; setSessionState(next);
    };
    changed();
    configureAuthBridge({ tenantCode, getSession: () => sessionRef.current });
    const unsubscribe = subscribeCustomerSession(tenantCode, changed);
    return () => { unsubscribe(); configureAuthBridge(null); };
  }, [tenantCode]);

  const logout = useCallback(async () => {
    if (tenantCode) await authApi.logout(tenantCode);
  }, [tenantCode]);

  const switchWorkspace = useCallback(async (workspaceCode: string) => {
    await sessionApi.switchWorkspace(workspaceCode);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    isAuthenticated: Boolean(session?.accessToken),
    customerName: session?.customer?.displayName || null,
    workspaces: session?.workspaces ?? [],
    currentWorkspace: session?.workspace ?? null,
    switchWorkspace,
    logout,
  }), [session, switchWorkspace, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
