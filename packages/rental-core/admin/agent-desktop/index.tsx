/** 显式组装原客户端授权页和无 DOM 的桌面桥接；宿主负责登记路由及供给当前菜单。 */
import type { ReactNode } from "react";
import { ClientAuthorizationPage } from "./ClientAuthorizationPage";
import { DesktopSessionBridge } from "./DesktopSessionBridge";
import { DesktopBusinessPolicySettings } from "./DesktopBusinessPolicySettings";
import { createRentalDesktopContext, RentalDesktopProvider, type RentalDesktopAdminOptions } from "./page-context";

export function createRentalDesktopAdmin(options: RentalDesktopAdminOptions) {
  const context = createRentalDesktopContext(options);
  return {
    Provider: function RentalDesktopAdminProvider({ children }: { children: ReactNode }) {
      return <RentalDesktopProvider value={context}>{children}</RentalDesktopProvider>;
    },
    ClientAuthorizationPage: function RentalClientAuthorizationPage() {
      return <RentalDesktopProvider value={context}><ClientAuthorizationPage /></RentalDesktopProvider>;
    },
    DesktopSessionBridge: function RentalDesktopSessionBridge() {
      return <RentalDesktopProvider value={context}><DesktopSessionBridge /></RentalDesktopProvider>;
    },
    DesktopBusinessPolicySettings: function RentalDesktopBusinessPolicySettings(props: { identity: string }) {
      return <RentalDesktopProvider value={context}><DesktopBusinessPolicySettings {...props} /></RentalDesktopProvider>;
    },
  };
}

export type { RentalDesktopAdminOptions } from "./page-context";
export type { DesktopNavigationSource, DesktopNavigationRoute, DesktopNavigationSection } from "./desktop-session-projection";
