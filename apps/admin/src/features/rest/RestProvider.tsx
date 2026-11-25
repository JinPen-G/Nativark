/** 原宿主保留浏览器与身份门禁；公共休息窗口不要求 Rental Core。 */
import type { ReactNode } from "react";
import { RestProvider as SharedRestProvider } from "@rental-os/platform-admin/source/features/rest/RestProvider";
import { rentalDesktopHost } from "@/features/agent-desktop/desktop-host";
import { useAuthStore } from "@/features/auth/authStore";

export function RestProvider({ children }: { children: ReactNode }) {
  const hasSession = useAuthStore(state => Boolean(state.token && state.user && state.tenant && !state.user.isSaasAdmin));
  const verified = useAuthStore(state => state.sessionVerified);
  return <SharedRestProvider browserSession={hasSession && !rentalDesktopHost()} verified={verified}>{children}</SharedRestProvider>;
}
