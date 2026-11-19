/** 企业门户仅提供构建配置，会话与业务请求由 Rental 企业客户端维护。 */
import type { ReactNode } from "react";
import { EnterpriseSessionProvider as RentalEnterpriseSessionProvider } from "@rental-os/rental-core/clients/enterprise";
export { CLIENT_BASE, useEnterprise } from "@rental-os/rental-core/clients/enterprise";

export function EnterpriseSessionProvider({ children }: { children: ReactNode }) {
  return <RentalEnterpriseSessionProvider offline={import.meta.env.MODE === "offline"}
    publicHosts={(import.meta.env.VITE_ENTERPRISE_PUBLIC_HOSTS ?? "").split(",")}
    development={import.meta.env.DEV}>{children}</RentalEnterpriseSessionProvider>;
}
