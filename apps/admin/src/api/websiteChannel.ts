/** web 官网渠道配置 API（WEBSITE-CHANNEL-01）：租户级官网特有设定项（标语、Hero、辅助色、页脚、联系地址、
 * 底部 CTA、SEO、Powered by 与官网启用开关）。对应 `/platform/website-channel`；通用品牌/协议仍走 `/platform/client-channel`。 */
import type {
  ApiResult,
  SaveWebsiteChannelProfileRequest,
  WebsiteChannelProfileSummary
} from "@rental-os/shared";
import { http } from "./http";

export const websiteChannelApi = {
  async getProfile() {
    const response = await http.get<ApiResult<WebsiteChannelProfileSummary>>("/platform/website-channel");
    return response.data.data;
  },
  async saveProfile(payload: SaveWebsiteChannelProfileRequest) {
    const response = await http.put<ApiResult<WebsiteChannelProfileSummary>>("/platform/website-channel", payload);
    return response.data.data;
  }
};
