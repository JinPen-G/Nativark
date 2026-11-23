/** 一次创建原桌面上下文，复用政策页、无 DOM 桥接和真实 preload 识别。
 * 桌面内容壳只接公共 Rest/订阅插槽，注册、登录与业务授权由原宿主负责。
 */
import type { ComponentType, ReactNode } from "react";
import type { RentalBrowserAdminSession } from "./browser";
import { createRentalDesktopAdmin } from "./agent-desktop";
import { ClientAuthorizationPage } from "./agent-desktop/ClientAuthorizationPage";
import { DesktopSessionBridge } from "./agent-desktop/DesktopSessionBridge";
import { rentalDesktopHost } from "./agent-desktop/desktop-host";
import {
  createRentalDesktopBrowserNavigation,
  type RentalDesktopBrowserNavigationOptions,
} from "./agent-desktop/browser-navigation";

export interface RentalDesktopContentShellProps {
  children: ReactNode;
  RestProvider: ComponentType<{ children: ReactNode; browserSession: false; verified: boolean }>;
  SubscriptionExpiryFloatingCard: ComponentType;
}

export interface RentalDesktopBrowserOptions extends RentalDesktopBrowserNavigationOptions {
  session: RentalBrowserAdminSession;
}

export function createRentalDesktopBrowser({ session, ...navigation }: RentalDesktopBrowserOptions) {
  const desktop = createRentalDesktopAdmin({ session,
    useNavigation: createRentalDesktopBrowserNavigation(navigation),
  });

  function ContentShell({ children, RestProvider, SubscriptionExpiryFloatingCard }: RentalDesktopContentShellProps) {
    const auth = session.useAuthStore();
    if (!rentalDesktopHost()) return null;
    return <RestProvider browserSession={false} verified={auth.sessionVerified}>
      <div className="desktop-business-content" style={{ height: "100vh", overflow: "auto", padding: "24px" }}>
        <main className="content-canvas">{children}</main>
        <SubscriptionExpiryFloatingCard />
      </div>
    </RestProvider>;
  }

  return {
    Provider: desktop.Provider,
    Bridge: DesktopSessionBridge,
    ClientAuthorizationPage,
    ContentShell,
    isDesktop: () => Boolean(rentalDesktopHost()),
  };
}
