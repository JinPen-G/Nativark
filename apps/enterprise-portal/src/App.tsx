/** 浏览器宿主只供给部署时公开配置，完整页面组合由 Rental 维护。 */
import { RentalEnterprisePortal } from "@rental-os/rental-core/clients/enterprise-portal";

export function App() {
  return <RentalEnterprisePortal offline={import.meta.env.MODE === "offline"}
    publicHosts={(import.meta.env.VITE_ENTERPRISE_PUBLIC_HOSTS ?? "").split(",")}
    development={import.meta.env.DEV} />;
}
