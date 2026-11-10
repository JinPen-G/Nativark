/** Operator host adapter for shared UI ownership; never used by customer apps. */
import { useRef, type ReactNode } from "react";
import { useAuthStore } from "@/features/auth/authStore";
import { currentSessionEpoch } from "@/app/queryClient";
import { BusinessUiScopeProvider } from "./ui/BusinessUiScope";
export function adminUiIdentity() {
  const state = useAuthStore.getState();
  return JSON.stringify([state.tenant?.tenantId, state.currentWorkspaceId, state.user?.id, currentSessionEpoch(), state.sessionVerified]);
}
export function AdminBusinessUiScope({ children }: { children: ReactNode }) {
  const auth = useAuthStore();
  const currentIdentity = useRef(adminUiIdentity); currentIdentity.current = adminUiIdentity;
  const identity = JSON.stringify([auth.tenant?.tenantId, auth.currentWorkspaceId, auth.user?.id, currentSessionEpoch(), auth.sessionVerified]);
  return <BusinessUiScopeProvider value={{ identity, currentIdentity: () => currentIdentity.current() }}>{children}</BusinessUiScopeProvider>;
}
