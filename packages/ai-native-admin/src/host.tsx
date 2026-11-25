/** Selected AI presentation consumes the existing verified AdminRuntime and
 * host scope. It owns no credentials, cache, model driver or business grant. */
import { createContext, useContext, type ReactNode } from "react";
import type { AuthUser, TenantIdentity } from "@rental-os/platform-contracts";
import { AdminRuntimeProvider, type AdminRuntime } from "@rental-os/platform-admin/runtime";

export interface AiAdminSession {
  sessionVerified: boolean;
  authenticated: boolean;
  tenant?: TenantIdentity;
  user?: AuthUser;
  currentWorkspaceId?: string;
  hasPermission(permission: string): boolean;
}

export interface AiAdminHost {
  runtime: AdminRuntime;
  /** Current business projection from the same verified host session. */
  getSession(): AiAdminSession;
}

const Context = createContext<AiAdminHost | null>(null);

export function createAiAdminHost(input: AiAdminHost): AiAdminHost {
  const { runtime, getSession } = input;
  for (const method of [getSession, runtime?.getSession, runtime?.subscribe,
    runtime?.request, runtime?.currentSessionEpoch, runtime?.currentSessionSignal]) {
    if (typeof method !== "function") throw new Error("AI presentation requires the original host ports");
  }
  return Object.freeze({ runtime, getSession: () => {
    const session = getSession(), platform = runtime.getSession();
    const sameIdentity = JSON.stringify([session.user, session.tenant])
      === JSON.stringify([platform.user, platform.tenant]);
    return platform.sessionVerified && sameIdentity
      ? session : { ...session, sessionVerified: false, authenticated: false };
  } });
}

export function AiAdminHostProvider({ host, children }: { host: AiAdminHost; children: ReactNode }) {
  return <AdminRuntimeProvider runtime={host.runtime}>
    <Context.Provider value={host}>{children}</Context.Provider>
  </AdminRuntimeProvider>;
}

export function useAiAdminHost(): AiAdminHost {
  const host = useContext(Context);
  if (!host) throw new Error("AI presentation requires the selected authenticated host");
  return host;
}
