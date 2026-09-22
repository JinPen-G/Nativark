import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { SaveWebsiteChannelProfileDto } from "./website-channel-profile.dto";
import { WebsiteChannelProfileService } from "./website-channel-profile.service";

interface RequestWithUser { user?: SystemUserRow; }

/**
 * 运营端：租户级 web 官网渠道配置（官网特有设定项）。
 * 与第三方服务、客户端渠道同一权限 system:integration:manage；通用品牌/协议在 /platform/client-channel。
 */
@Controller("platform/website-channel")
export class WebsiteChannelProfileController {
  constructor(private readonly service: WebsiteChannelProfileService) {}

  @Get()
  get(@Req() req: RequestWithUser) {
    return this.service.get(req.user);
  }

  @Put()
  save(@Body() body: SaveWebsiteChannelProfileDto, @Req() req: RequestWithUser) {
    return this.service.save(body, req.user);
  }
}
