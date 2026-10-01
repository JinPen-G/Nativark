/** 账户级外观 API：跟随登录账户的管理后台主题色（与租户品牌色相互独立）。对应 `/platform/account-appearance`。 */
import type { AccountAppearanceProfile, ApiResult, SaveAccountAppearanceRequest } from "@rental-os/shared";
import { http } from "./http";

export const accountAppearanceApi = {
  async getProfile() {
    const response = await http.get<ApiResult<AccountAppearanceProfile>>("/platform/account-appearance");
    return response.data.data;
  },
  async saveProfile(payload: SaveAccountAppearanceRequest) {
    const response = await http.put<ApiResult<AccountAppearanceProfile>>("/platform/account-appearance", payload);
    return response.data.data;
  }
};
