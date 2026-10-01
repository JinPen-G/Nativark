import type { SaveAccountAppearanceRequest } from "@rental-os/shared";
import { IsOptional, IsString, Matches } from "class-validator";

/**
 * 账户级外观保存 DTO：目前仅管理后台主题色（跟随登录账户，与租户品牌色相互独立）。
 * 允许空字符串（清除→回退平台默认色）；非空须为 #RGB/#RRGGBB，服务层归一化为大写 #RRGGBB。
 */
export class SaveAccountAppearanceDto implements SaveAccountAppearanceRequest {
  @IsOptional() @IsString()
  @Matches(/^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$/u, { message: "主题色需为 #RRGGBB 十六进制颜色" })
  themeColor?: string;
}
