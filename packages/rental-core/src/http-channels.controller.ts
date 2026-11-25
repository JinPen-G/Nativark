/** 原Rental渠道Controller；保留URL/DTO/上传限制，实际身份与细粒度许可沿宿主Guard。 */
import { BadRequestException, Body, Controller, Get, Inject, Post, Put, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { SaveClientChannelProfileDto, SaveWebsiteChannelProfileDto, SaveMiniProgramChannelDto } from "./http-channel.dto";
import type { UploadedWebsiteImage } from "./mysql-client-website-assets";
import { RENTAL_CLIENT_CHANNEL_APPLICATION, RENTAL_WEBSITE_CHANNEL_APPLICATION, RENTAL_WEBSITE_ASSET_APPLICATION, RENTAL_MINI_PROGRAM_CHANNEL_APPLICATION } from "./http-channel-applications";
import type { RentalClientChannelHttpApplication, RentalWebsiteChannelHttpApplication, RentalWebsiteAssetHttpApplication, RentalMiniProgramChannelHttpApplication } from "./http-channel-applications";

interface RequestWithUser { user?: SystemUserRow; }


/**
 * 运营端：租户级客户端渠道配置（品牌/客服/协议/帮助/发布服务，小程序与 APP 共用）。
 * 与第三方服务同一权限 system:integration:manage；微信凭证在 /platform/mini-program-channel。
 */
@Controller("platform/client-channel")
export class ClientChannelProfileController {
  constructor(@Inject(RENTAL_CLIENT_CHANNEL_APPLICATION) private readonly service: RentalClientChannelHttpApplication) {}

  @Get()
  get(@Req() req: RequestWithUser) {
    return this.service.get(req.user);
  }

  @Put()
  save(@Body() body: SaveClientChannelProfileDto, @Req() req: RequestWithUser) {
    return this.service.save(body, req.user);
  }
}


/**
 * 运营端：租户级 web 官网渠道配置（官网特有设定项）+ 品牌图片上传。
 * 与第三方服务、客户端渠道同一权限 system:integration:manage；通用品牌/协议在 /platform/client-channel。
 */
@Controller("platform/website-channel")
export class WebsiteChannelProfileController {
  constructor(
    @Inject(RENTAL_WEBSITE_CHANNEL_APPLICATION) private readonly service: RentalWebsiteChannelHttpApplication,
    @Inject(RENTAL_WEBSITE_ASSET_APPLICATION) private readonly assets: RentalWebsiteAssetHttpApplication
  ) {}

  @Get()
  get(@Req() req: RequestWithUser) {
    return this.service.get(req.user);
  }

  @Put()
  save(@Body() body: SaveWebsiteChannelProfileDto, @Req() req: RequestWithUser) {
    return this.service.save(body, req.user);
  }

  /** 上传品牌图片（Logo/Favicon/Hero/品类入口图）；返回可写入配置的公开 URL。scene: logo|favicon|hero|category。 */
  @Post("assets")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  uploadAsset(@Req() req: RequestWithUser, @Body("scene") scene: string, @UploadedFile() file?: UploadedWebsiteImage) {
    if (!file) throw new BadRequestException("请选择要上传的图片");
    return this.assets.upload(req.user, scene, file);
  }
}


/** 运营端：租户的微信小程序渠道（与第三方服务同一权限 system:integration:manage）。 */
@Controller("platform/mini-program-channel")
export class MiniProgramChannelController {
  constructor(@Inject(RENTAL_MINI_PROGRAM_CHANNEL_APPLICATION) private readonly service: RentalMiniProgramChannelHttpApplication) {}

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
