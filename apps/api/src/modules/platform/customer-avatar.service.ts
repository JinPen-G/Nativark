/** Tenant-shared customer avatars, behind the original customer Guard and record scope.
 * Local bitmap storage follows the existing development catalog-image fallback.
 * Production requires a managed-storage adapter; it never silently writes local files.
 */
import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { PrismaService } from "../database/prisma.service";

export interface CustomerAvatarUpload { buffer: Buffer; mimetype: string; size: number; }
@Injectable()
export class CustomerAvatarService {
  constructor(private readonly prisma: PrismaService) {}
  private location(tenantId: string, customerId: string, key: string) {
    if (![tenantId, customerId].every(value => /^[a-zA-Z0-9_-]+$/u.test(value)) || !/^[a-f0-9]{32}\.(png|jpg|webp)$/u.test(key)) throw new NotFoundException("客户头像不存在");
    const root = resolve(process.env.RENTAL_UPLOAD_DIR ?? resolve(process.cwd(), "var", "uploads"));
    const target = resolve(root, "customer-avatars", tenantId, customerId, key);
    if (!target.startsWith(root + sep)) throw new NotFoundException("客户头像不存在");
    return target;
  }
  private assertStorage() {
    if (process.env.NODE_ENV === "production") throw new ServiceUnavailableException("客户头像尚未装配受控文件存储");
  }
  private async row(tenantId: string, customerId: string) {
    // Select only the new field: existing generated clients can coexist during the additive migration rollout.
    const rows = await this.prisma.$queryRaw<Array<{ avatarStorageKey: string | null }>>`
      SELECT avatarStorageKey FROM customer_profiles
      WHERE tenantId = ${tenantId} AND id = ${customerId} AND mergedIntoCustomerId IS NULL LIMIT 1`;
    if (!rows.length) throw new NotFoundException("客户不存在");
    return rows[0];
  }
  async read(tenantId: string, customerId: string) {
    this.assertStorage(); const row = await this.row(tenantId, customerId);
    if (!row.avatarStorageKey) throw new NotFoundException("客户尚未设置头像");
    try {
      const content = await readFile(this.location(tenantId, customerId, row.avatarStorageKey));
      // Recheck the current record after file I/O; a merge or replacement must not return stale content.
      if ((await this.row(tenantId, customerId)).avatarStorageKey !== row.avatarStorageKey) throw new NotFoundException("客户头像已更新");
      return { content, mimeType: row.avatarStorageKey.endsWith(".jpg") ? "image/jpeg" : row.avatarStorageKey.endsWith(".webp") ? "image/webp" : "image/png" };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundException("客户头像文件不存在"); throw error; }
  }
  async save(tenantId: string, customerId: string, file: CustomerAvatarUpload) {
    this.assertStorage();await this.row(tenantId, customerId);
    if (!file.buffer?.length || file.buffer.length !== file.size || file.size > 5 * 1024 * 1024) throw new BadRequestException("头像必须是5MB以内的位图");
    const b=file.buffer;
    const ext=file.mimetype==="image/png" && b.length>=8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png"
      : file.mimetype==="image/jpeg" && b.length>=3 && b[0]===255 && b[1]===216 && b[2]===255 ? "jpg"
      : file.mimetype==="image/webp" && b.length>=12 && b.toString("ascii",0,4)==="RIFF" && b.toString("ascii",8,12)==="WEBP" ? "webp" : undefined;
    if (!ext) throw new BadRequestException("只接受内容与格式一致的PNG、JPEG或WebP头像");
    const key=randomUUID().replace(/-/gu,"")+"."+ext;const target=this.location(tenantId,customerId,key);
    await mkdir(resolve(target,".."),{recursive:true});await writeFile(target,b,{flag:"wx"});
    try {
      const changed=await this.prisma.$executeRaw`UPDATE customer_profiles SET avatarStorageKey=${key}, updatedAt=NOW(3)
        WHERE tenantId=${tenantId} AND id=${customerId} AND mergedIntoCustomerId IS NULL`;
      if(changed!==1)throw new NotFoundException("客户已变化，请重新读取");
    } catch(error) { await unlink(target).catch(()=>undefined); throw error; }
    return { customerId, avatarUrl: `/api/platform/customers/${encodeURIComponent(customerId)}/avatar` };
  }
}
