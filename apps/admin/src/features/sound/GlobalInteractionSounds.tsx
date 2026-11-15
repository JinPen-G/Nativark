/** 原管理端提供已验证身份的音效范围，公共呈现不导入业务 Auth。 */
import { GlobalInteractionSounds as SharedInteractionSounds } from "@rental-os/platform-admin/source/features/sound/GlobalInteractionSounds";
import { currentSessionEpoch } from "@/app/queryClient";
import { useAuthStore } from "@/features/auth/authStore";

export function GlobalInteractionSounds() {
  const userId = useAuthStore(state => state.user?.id);
  const tenantId = useAuthStore(state => state.tenant?.tenantId);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  return <SharedInteractionSounds scope={userId ? {
    key: JSON.stringify([userId, tenantId ?? "platform", workspaceId ?? "none"]), epoch: currentSessionEpoch()
  } : null} />;
}
