import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { SaveTenantAppearanceDto } from "./tenant-appearance-profile.dto";
import { TenantAppearanceProfileService } from "./tenant-appearance-profile.service";

interface RequestWithUser { user?: SystemUserRow; }

/**
 * 运营端：租户级「品牌与外观」（管理后台 UI 身份）——品牌名/Logo/Favicon、主题色、四组圆角。
 * 从客户端渠道配置拆出的独立领域；沿用 system:integration:manage（同一渠道/集成管理员），
 * 微信凭证与客户端内容各走各自控制器。
 */
@Controller("platform/appearance")
export class TenantAppearanceProfileController {
  constructor(private readonly service: TenantAppearanceProfileService) {}

  @Get()
  get(@Req() req: RequestWithUser) {
    return this.service.get(req.user);
  }

  @Put()
  save(@Body() body: SaveTenantAppearanceDto, @Req() req: RequestWithUser) {
    return this.service.save(body, req.user);
  }
}
