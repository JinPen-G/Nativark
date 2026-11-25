/** 原官网图片的Nest接线，Rental维护字节校验、租户归属和公开读取路径。 */
import { Injectable } from "@nestjs/common";
import { WebsiteAssetService as RentalWebsiteAssetService } from "@rental-os/rental-core/mysql-client-website-assets";
import { PrismaService } from "../database/prisma.service";
export type { UploadedWebsiteImage } from "@rental-os/rental-core/mysql-client-website-assets";

@Injectable()
export class WebsiteAssetService extends RentalWebsiteAssetService {
  constructor(prisma: PrismaService) { super(prisma); }
}
