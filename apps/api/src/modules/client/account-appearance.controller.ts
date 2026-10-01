import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { SaveAccountAppearanceDto } from "./account-appearance.dto";
import { AccountAppearanceService } from "./account-appearance.service";

interface RequestWithUser { user?: SystemUserRow; }

/**
 * 运营端：账户级「外观」自助设置——目前仅管理后台主题色，跟随登录账户、与租户品牌色相互独立。
 * 任何已登录账号可读写**自己的**设置（ApiAuthGuard 按会话 user.id 作用域，不挂业务权限）。
 */
@Controller("platform/account-appearance")
export class AccountAppearanceController {
  constructor(private readonly service: AccountAppearanceService) {}

  @Get()
  get(@Req() req: RequestWithUser) {
    return this.service.get(req.user);
  }

  @Put()
  save(@Body() body: SaveAccountAppearanceDto, @Req() req: RequestWithUser) {
    return this.service.save(body, req.user);
  }
}
