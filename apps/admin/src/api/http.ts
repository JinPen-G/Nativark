/** 原后台以同一公共缓存消费 Rental 浏览器会话，所有原 HTTP 入口继续复用。 */
import { createRentalBrowserAdminSession } from "@rental-os/rental-core/admin/browser";
import { queryClient, clearSessionQueryCache, currentSessionEpoch, currentSessionSignal } from "@/app/queryClient";

export const rentalBrowserSession = createRentalBrowserAdminSession({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  queries: { queryClient, clearSessionQueryCache, currentSessionEpoch, currentSessionSignal },
});
export const { http, request, requestText, apiAssetOrigin, onSessionRefreshed } = rentalBrowserSession;
if (import.meta.hot) import.meta.hot.dispose(() => rentalBrowserSession.dispose());
