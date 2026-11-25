/** 原后台桌面接口复用唯一请求与 Rental 工厂。 */
import { createDesktopBusinessApi } from "@rental-os/rental-core/admin/agent-desktop/client";
import { request } from "./http";
export const { desktopBusinessPolicyApi, readDesktopBusinessCatalog } = createDesktopBusinessApi(request);
