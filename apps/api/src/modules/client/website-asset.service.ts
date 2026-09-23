import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import { requireRequestTenantId } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";

export interface UploadedWebsiteImage { originalname: string; mimetype: string; size: number; buffer: Buffer; }

const MAX_BYTES = 2 * 1024 * 1024; // 官网品牌图上限 2MB
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const SCENES = new Set(["logo", "hero", "category"]);

/** 图片魔数校验，防止仅靠 MIME 头伪造。 */
function matchesSignature(mimeType: string, content: Buffer): boolean {
  if (mimeType === "image/jpeg") return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  if (mimeType === "image/png") return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

/**
 * WEBSITE-CHANNEL-04：官网品牌图片（Logo/Hero/品类入口图）的上传与公开读取。
 * 字节直接入库；公开读取按 tenantCode + assetId，并核对图片确属该租户，避免越权读到其它文件。
 */
@Injectable()
export class WebsiteAssetService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantOf(user?: SystemUserRow): string {
    if (user?.isSaasAdmin) throw new BadRequestException("SaaS 平台账号不能上传租户官网图片");
    return user?.tenantId ?? requireRequestTenantId();
  }

  /** 运营端上传一张官网图片，返回可写入配置的公开 URL。 */
  async upload(user: SystemUserRow | undefined, scene: string, file: UploadedWebsiteImage): Promise<{ assetId: string; url: string; mimeType: string }> {
    const tenantId = this.tenantOf(user);
    const useScene = SCENES.has(scene) ? scene : "hero";
    if (!EXT[file?.mimetype]) throw new BadRequestException("只支持 JPG、PNG 或 WebP 图片");
    if (!file.buffer?.length || file.size <= 0) throw new BadRequestException("图片文件为空");
    if (file.size > MAX_BYTES || file.buffer.length > MAX_BYTES) throw new PayloadTooLargeException("单张图片不能超过 2MB");
    if (!matchesSignature(file.mimetype, file.buffer)) throw new BadRequestException("图片内容与文件格式不一致");

    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId }, select: { code: true } });
    if (!tenant) throw new NotFoundException("租户不存在");
    const asset = await this.prisma.websiteAsset.create({
      data: { tenantId, scene: useScene, mimeType: file.mimetype, sizeBytes: file.buffer.length, data: file.buffer },
      select: { id: true }
    });
    return { assetId: asset.id, mimeType: file.mimetype, url: `/api/client/v1/public/website-assets/${encodeURIComponent(tenant.code)}/${asset.id}` };
  }

  /** 公开读取：按 tenantCode + assetId 取字节，核对归属，返回内容供客户端渲染。 */
  async read(tenantCode: string, assetId: string): Promise<{ content: Buffer; mimeType: string }> {
    const tenant = await this.prisma.tenant.findFirst({ where: { code: tenantCode.trim(), status: "ACTIVE" }, select: { id: true } });
    if (!tenant) throw new NotFoundException("图片不存在");
    const asset = await this.prisma.websiteAsset.findFirst({ where: { id: assetId, tenantId: tenant.id }, select: { data: true, mimeType: true } });
    if (!asset) throw new NotFoundException("图片不存在");
    return { content: Buffer.from(asset.data), mimeType: asset.mimeType };
  }
}
