/** Original combined admin binds the selected AI UI to its one verified
 * auth store, query epoch and transport. This adapter never creates a session. */
import type { ReactNode } from "react";
import { AiAdminHostProvider, createAiAdminHost } from "@rental-os/ai-native-admin/host";
import { adminRuntime } from "@/app/adminRuntime";
import { useAuthStore } from "@/features/auth/authStore";

export const legacyAiAdminHost = createAiAdminHost({
  runtime: adminRuntime,
  getSession: () => {
    const auth = useAuthStore.getState();
    return {
      sessionVerified: auth.sessionVerified,
      authenticated: Boolean(auth.token),
      tenant: auth.tenant,
      user: auth.user,
      currentWorkspaceId: auth.currentWorkspaceId,
      hasPermission: auth.hasPermission,
    };
  },
});

export function LegacyAiAdminHost({ children }: { children: ReactNode }) {
  return <AiAdminHostProvider host={legacyAiAdminHost}>{children}</AiAdminHostProvider>;
}
