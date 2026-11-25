/** Operator host adapter for shared UI ownership; never used by customer apps. */
import { useRef, type ReactNode } from "react";
import { useAuthStore } from "@/features/auth/authStore";
import { currentSessionEpoch } from "@/app/queryClient";
import { BusinessUiScopeProvider } from "./ui/BusinessUiScope";
export function adminUiIdentity() {
  const state = useAuthStore.getState();
  return JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user?.id, currentSessionEpoch(), state.sessionVerified,
    state.user?.isPlatformAdmin, state.user?.isSaasAdmin, state.user?.dataScope, state.user?.locationScope,
    state.user?.permissions && [...new Set(state.user.permissions)].sort(), state.user?.organizationId]);
}
export function AdminBusinessUiScope({ children }: { children: ReactNode }) {
  const auth = useAuthStore();
  const currentIdentity = useRef(adminUiIdentity); currentIdentity.current = adminUiIdentity;
  const identity = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, currentSessionEpoch(), auth.sessionVerified,
    auth.user?.isPlatformAdmin, auth.user?.isSaasAdmin, auth.user?.dataScope, auth.user?.locationScope,
    auth.user?.permissions && [...new Set(auth.user.permissions)].sort(), auth.user?.organizationId]);
  return <BusinessUiScopeProvider value={{ identity, currentIdentity: () => currentIdentity.current() }}>{children}</BusinessUiScopeProvider>;
}
