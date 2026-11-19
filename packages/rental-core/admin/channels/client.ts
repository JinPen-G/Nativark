/** 客户端品牌、协议、发布空间与微信凭证沿原 HTTP 读取和保存。公共 bootstrap 支持登录前读取。 */
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  ClientChannelProfileSummary,
  MiniProgramChannelSummary,
  MiniProgramChannelTestResult,
  SaveClientChannelProfileRequest,
  SaveMiniProgramChannelRequest,
} from "@rental-os/rental-core";
import type { ClientChannelBootstrapResponse } from "@rental-os/rental-core/client-contracts";

export function createRentalClientChannelApi(request: AdminRuntime["request"]) {
  return {
    getPublicBootstrap: (tenantCode: string, signal?: AbortSignal) =>
      request<ClientChannelBootstrapResponse>("/client/v1/public/bootstrap", {
        params: { tenantCode, client: "web" },
        signal,
      }),
    getProfile: (signal?: AbortSignal) =>
      request<ClientChannelProfileSummary>("/platform/client-channel", { signal }),
    saveProfile: (data: SaveClientChannelProfileRequest) =>
      request<ClientChannelProfileSummary>("/platform/client-channel", { method: "put", data }),
    getWechat: (signal?: AbortSignal) =>
      request<MiniProgramChannelSummary>("/platform/mini-program-channel", { signal }),
    saveWechat: (data: SaveMiniProgramChannelRequest) =>
      request<MiniProgramChannelSummary>("/platform/mini-program-channel", { method: "put", data }),
    testWechat: () =>
      request<MiniProgramChannelTestResult>("/platform/mini-program-channel/test", { method: "post" }),
  };
}

export type RentalClientChannelApi = ReturnType<typeof createRentalClientChannelApi>;
