import { BadRequestException, Body, Controller, Get, Param, Post, Put, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { SystemUserRow } from "@rental-os/shared";
import { SaveWebsiteChannelProfileDto } from "./website-channel-profile.dto";
import { WebsiteChannelProfileService } from "./website-channel-profile.service";
import { WebsiteAssetService, type UploadedWebsiteImage } from "./website-asset.service";

interface RequestWithUser { user?: SystemUserRow; }

/**
 * 运营端：租户级 web 官网渠道配置（官网特有设定项）+ 品牌图片上传。
 * 与第三方服务、客户端渠道同一权限 system:integration:manage；通用品牌/协议在 /platform/client-channel。
 */
@Controller("platform/website-channel")
export class WebsiteChannelProfileController {
  constructor(
    private readonly service: WebsiteChannelProfileService,
    private readonly assets: WebsiteAssetService
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
