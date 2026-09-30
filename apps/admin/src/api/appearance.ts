/** 品牌与外观 API（APPEARANCE-01）：租户级管理后台 UI 身份——品牌名/Logo/Favicon、主题色、四组圆角。
 * 从客户端渠道配置拆出的独立领域，对应 `/platform/appearance`。 */
import type { ApiResult, SaveTenantAppearanceRequest, TenantAppearanceProfile } from "@rental-os/shared";
import { http } from "./http";

export const appearanceApi = {
  async getProfile() {
    const response = await http.get<ApiResult<TenantAppearanceProfile>>("/platform/appearance");
    return response.data.data;
  },
  async saveProfile(payload: SaveTenantAppearanceRequest) {
    const response = await http.put<ApiResult<TenantAppearanceProfile>>("/platform/appearance", payload);
    return response.data.data;
  }
};
