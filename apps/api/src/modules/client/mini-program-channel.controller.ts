import { Body, Controller, Get, Post, Put, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { SaveMiniProgramChannelDto } from "./mini-program-channel.dto";
import { MiniProgramChannelService } from "./mini-program-channel.service";

interface RequestWithUser { user?: SystemUserRow; }

/** 运营端：租户的微信小程序渠道（与第三方服务同一权限 system:integration:manage）。 */
@Controller("platform/mini-program-channel")
export class MiniProgramChannelController {
  constructor(private readonly service: MiniProgramChannelService) {}

  @Get()
  get(@Req() req: RequestWithUser) {
    return this.service.get(req.user);
  }

  @Put()
  save(@Body() body: SaveMiniProgramChannelDto, @Req() req: RequestWithUser) {
    return this.service.save(body, req.user);
  }

  @Post("test")
  test(@Req() req: RequestWithUser) {
    return this.service.test(req.user);
  }
}
