import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSite } from './SiteContext';
import {
  authApi, configureAuthBridge, loadSession, saveSession, sessionApi,
  type ClientSession, type WorkspaceRef,
} from './data/authClient';

interface AuthContextValue {
  /** 当前登录会话；未登录为 null。演示模式恒为 null（无后端可登录）。 */
  session: ClientSession | null;
  isAuthenticated: boolean;
  customerName: string | null;
  workspaces: WorkspaceRef[];
  currentWorkspace: WorkspaceRef | null;
  setSession: (session: ClientSession | null) => void;
  /** 切换当前会话所在经营空间（下单/报价按当前空间计价）。 */
  switchWorkspace: (workspaceCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { tenantCode } = useSite();
  const [session, setSessionState] = useState<ClientSession | null>(() => (tenantCode ? loadSession(tenantCode) : null));
  // 用 ref 让 authClient 的 bridge 始终读到最新会话，避免闭包过期。
  const sessionRef = useRef<ClientSession | null>(session);
  sessionRef.current = session;

  const persist = useCallback((next: ClientSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
    if (tenantCode) saveSession(tenantCode, next);
  }, [tenantCode]);

  // 切换租户时重新载入该租户的会话（会话按租户隔离）。
  useEffect(() => {
    const loaded = tenantCode ? loadSession(tenantCode) : null;
    sessionRef.current = loaded;
    setSessionState(loaded);
  }, [tenantCode]);

  // 向 authClient 注册当前会话读写器：401 自动续期后回写、续期失败清空。
  useEffect(() => {
    configureAuthBridge({ getSession: () => sessionRef.current, setSession: persist });
    return () => configureAuthBridge(null);
  }, [persist]);

  const logout = useCallback(async () => {
    const token = sessionRef.current?.refreshToken;
    persist(null);
    if (token) await authApi.logout(token);
  }, [persist]);

  const switchWorkspace = useCallback(async (workspaceCode: string) => {
    const next = await sessionApi.switchWorkspace(workspaceCode);
    persist(next);
  }, [persist]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    isAuthenticated: Boolean(session?.accessToken),
    customerName: (session?.customer?.name as string) || null,
    workspaces: session?.workspaces ?? [],
    currentWorkspace: session?.workspace ?? null,
    setSession: persist,
    switchWorkspace,
    logout,
  }), [session, persist, switchWorkspace, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
