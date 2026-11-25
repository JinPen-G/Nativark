/** 原渠道请求委托 Rental 单源工厂，登录前 bootstrap 继续使用原公共传输。 */
import { createRentalClientChannelApi } from "@rental-os/rental-core/admin/channels/client";
import type { ApiResult } from "@rental-os/platform-contracts";
import type { AdminRequestOptions } from "@rental-os/platform-admin/runtime";
import axios from "axios";
import { request } from "./http";

// 登录前读取网址租户的公开品牌，不能携带缓存中的另一租户凭据或触发会话刷新。
const publicHttp = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api", timeout: 12_000, withCredentials: false,
  headers: { Authorization: null, "x-tenant-id": null, "x-tenant-code": null, "x-workspace-id": null },
});
const publicChannelApi = createRentalClientChannelApi(async <Output,>(path: string, options?: AdminRequestOptions) =>
  (await publicHttp.request<ApiResult<Output>>({ url: path, method: "get", ...options })).data.data);

export const clientChannelApi = {
  ...createRentalClientChannelApi(request),
  getPublicBootstrap: publicChannelApi.getPublicBootstrap,
};
