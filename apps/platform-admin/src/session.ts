/** 默认公共宿主只有一个认证/HTTP/查询缓存，业务 Core 不能自行创建凭据。 */
import { createBrowserAdminSession } from "@rental-os/platform-admin/runtime";

export const session = createBrowserAdminSession({ baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api", storageKey: "nativark:admin" });
if (import.meta.hot) import.meta.hot.dispose(() => session.dispose());
