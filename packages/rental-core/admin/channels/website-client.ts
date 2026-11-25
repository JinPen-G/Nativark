/** 官网配置与品牌图片使用原官网渠道 HTTP，上传保留原 FormData 字段及取消信号。 */
import type { AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  SaveWebsiteChannelProfileRequest,
  WebsiteChannelProfileSummary,
} from "@rental-os/rental-core";

export type RentalChannelAssetScene = "logo" | "favicon" | "hero" | "category";

export function createRentalWebsiteChannelApi(request: AdminRuntime["request"]) {
  return {
    getProfile: (signal?: AbortSignal) =>
      request<WebsiteChannelProfileSummary>("/platform/website-channel", { signal }),
    saveProfile: (data: SaveWebsiteChannelProfileRequest) =>
      request<WebsiteChannelProfileSummary>("/platform/website-channel", { method: "put", data }),
    uploadAsset: (scene: RentalChannelAssetScene, file: File, signal?: AbortSignal) => {
      const data = new FormData();
      data.append("scene", scene);
      data.append("file", file);
      return request<{ assetId: string; url: string; mimeType: string }>(
        "/platform/website-channel/assets",
        { method: "post", data, signal },
      );
    },
  };
}

export type RentalWebsiteChannelApi = ReturnType<typeof createRentalWebsiteChannelApi>;
