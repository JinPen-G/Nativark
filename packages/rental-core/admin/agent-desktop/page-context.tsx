/** 原桌面页面复用同一 Rental 浏览器会话、请求和已登记菜单；不创建认证或桌面授权。 */
import { createContext, useContext, type ReactNode } from "react";
import type { RentalBrowserAdminSession } from "../browser";
import { createRentalOrderApi } from "../orders/client";
import { createDesktopBusinessApi } from "./client";
import type { DesktopNavigationSource } from "./desktop-session-projection";

export interface RentalDesktopAdminOptions {
  session: RentalBrowserAdminSession;
  /** 同一外壳当前登记且获权的菜单；该 hook 须订阅菜单权限变化。 */
  useNavigation: () => DesktopNavigationSource;
}

export function createRentalDesktopContext(options: RentalDesktopAdminOptions) {
  const { session, useNavigation } = options;
  if (typeof session?.useAuthStore !== "function" || typeof session.runtime?.request !== "function"
    || typeof session.currentSessionEpoch !== "function" || typeof useNavigation !== "function") {
    throw new Error("桌面页面缺少原会话、请求或当前导航接点");
  }
  return Object.freeze({ session, useNavigation,
    ...createDesktopBusinessApi(session.runtime.request),
    profile: createRentalOrderApi(session.runtime.request).profile,
  });
}

export type RentalDesktopContext = ReturnType<typeof createRentalDesktopContext>;
const Context = createContext<RentalDesktopContext | null>(null);

export function RentalDesktopProvider({ value, children }: { value: RentalDesktopContext; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRentalDesktopContext() {
  const value = useContext(Context);
  if (!value) throw new Error("桌面页面必须接入原 Rental 浏览器宿主");
  return value;
}
