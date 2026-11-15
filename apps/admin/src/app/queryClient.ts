/** 原 Rental 宿主保留同一缓存和会话代次；公共实现不读取行业身份。 */
import { createAdminSessionQueries } from "@rental-os/platform-admin/runtime";
export { isTransientRefreshError } from "@rental-os/platform-admin/runtime";

export const { queryClient, currentSessionEpoch, currentSessionSignal, clearSessionQueryCache } =
  createAdminSessionQueries(() => typeof window !== "undefined" && Boolean(window.localStorage.getItem("rental_access_token")));
