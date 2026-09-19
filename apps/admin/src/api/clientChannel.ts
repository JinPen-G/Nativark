/** 客户端渠道配置 API（CLIENT-CHANNEL-01）：租户级品牌/客服/协议/帮助/发布服务（小程序与 APP 共用），
 * 以及微信小程序渠道凭证（AppID/AppSecret 与连通性测试）。分别对应 `/platform/client-channel` 与 `/platform/mini-program-channel`。 */
import type {
  ApiResult,
  ClientChannelProfileSummary,
  MiniProgramChannelSummary,
  MiniProgramChannelTestResult,
  SaveClientChannelProfileRequest,
  SaveMiniProgramChannelRequest
} from "@rental-os/shared";
import { http } from "./http";

export const clientChannelApi = {
  async getProfile() {
    const response = await http.get<ApiResult<ClientChannelProfileSummary>>("/platform/client-channel");
    return response.data.data;
  },
  async saveProfile(payload: SaveClientChannelProfileRequest) {
    const response = await http.put<ApiResult<ClientChannelProfileSummary>>("/platform/client-channel", payload);
    return response.data.data;
  },
  async getWechat() {
    const response = await http.get<ApiResult<MiniProgramChannelSummary>>("/platform/mini-program-channel");
    return response.data.data;
  },
  async saveWechat(payload: SaveMiniProgramChannelRequest) {
    const response = await http.put<ApiResult<MiniProgramChannelSummary>>("/platform/mini-program-channel", payload);
    return response.data.data;
  },
  async testWechat() {
    const response = await http.post<ApiResult<MiniProgramChannelTestResult>>("/platform/mini-program-channel/test");
    return response.data.data;
  }
};
