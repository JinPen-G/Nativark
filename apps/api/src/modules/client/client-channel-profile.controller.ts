import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { SaveClientChannelProfileDto } from "./client-channel-profile.dto";
import { ClientChannelProfileService } from "./client-channel-profile.service";

interface RequestWithUser { user?: SystemUserRow; }

/**
 * 运营端：租户级客户端渠道配置（品牌/客服/协议/帮助/发布服务，小程序与 APP 共用）。
 * 与第三方服务同一权限 system:integration:manage；微信凭证在 /platform/mini-program-channel。
 */
@Controller("platform/client-channel")
export class ClientChannelProfileController {
  constructor(private readonly service: ClientChannelProfileService) {}

  @Get()
  get(@Req() req: RequestWithUser) {
    return this.service.get(req.user);
  }

  @Put()
  save(@Body() body: SaveClientChannelProfileDto, @Req() req: RequestWithUser) {
    return this.service.save(body, req.user);
  }
}
