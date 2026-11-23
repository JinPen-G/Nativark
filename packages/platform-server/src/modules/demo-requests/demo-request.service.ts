/** 平台官网线索的单源创建与分页。保留原摘要、真实 P2002 回读和个人资料投影，列表沿原签名主体返前复验。 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { isPrismaKnownRequestError } from "../../prisma-runtime";
import { createHash, randomUUID } from "node:crypto";
import { isEmail } from "class-validator";
import type { CreateDemoRequestInput, DemoContactType, DemoRequestListQuery, DemoRequestPage, DemoRequestReceipt } from "@rental-os/platform-contracts/demo-request";
import type { PlatformPrincipal, SystemUserRow } from "@rental-os/platform-contracts";
import { PLATFORM_AUTH_DATA_STORE } from "../platform/platform-auth-data-store";
import { PlatformIdentityRepository } from "../platform/platform-identity.repository";
import { PlatformPrincipalAuthority } from "../platform/platform-principal.authority";
import type { DemoRequestDatabase } from "./demo-request.store";

@Injectable()
export class DemoRequestService {
  private readonly principals: PlatformPrincipalAuthority;

  constructor(@Inject(PLATFORM_AUTH_DATA_STORE) private readonly prisma: DemoRequestDatabase) {
    this.principals = new PlatformPrincipalAuthority(new PlatformIdentityRepository(prisma));
  }

  private assertListUser(user: SystemUserRow) {
    // 原 hasAnyPermission 对此平台线索按真实 SaaS 身份放行，保留其隐含能力。
    if (!user.isSaasAdmin)
      throw new ForbiddenException("仅获权 SaaS 平台管理员可以查看演示预约");
  }

  private assertListAccess(actor: PlatformPrincipal) {
    return this.prisma.$transaction(async tx => {
      const lease = await this.principals.lock(tx, actor, actor.tenantId);
      this.assertListUser(lease.user);
      this.assertListUser(await lease.revalidate());
    }, { isolationLevel: "Serializable" });
  }

  async create(input: CreateDemoRequestInput): Promise<DemoRequestReceipt> {
    const data = {
      name: input.name.trim(),
      contactType: input.contactType,
      contactValue: input.contactValue.trim(),
      company: input.company?.trim() ?? "",
      message: input.message?.trim() ?? "",
      language: input.language
    };
    // 联系方式按类型校验，不把私人信息拼进报错或操作日志。
    const phoneDigits = data.contactValue.replace(/\D/g, "");
    const validContact = data.contactType === "email"
      ? isEmail(data.contactValue)
      : data.contactType === "phone"
        ? /^\+?[0-9 ()-]+$/.test(data.contactValue) && phoneDigits.length >= 7 && phoneDigits.length <= 20
        : data.contactType === "wechat" && /^[a-zA-Z0-9_-]{3,80}$/.test(data.contactValue);
    if (!validContact) throw new BadRequestException("联系方式格式不正确");
    if (!data.name || /[\u0000-\u001f\u007f]/.test(data.name + data.company + data.contactValue)) {
      throw new BadRequestException("请填写有效的姓名和联系方式");
    }
    const payloadHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    try {
      await this.prisma.demoRequest.create({
        data: { id: randomUUID(), requestKey: input.requestKey, payloadHash, ...data }
      });
    } catch (error) {
      if (!isPrismaKnownRequestError(error) || error.code !== "P2002") throw error;
      const previous = await this.prisma.demoRequest.findUnique({
        where: { requestKey: input.requestKey }, select: { payloadHash: true }
      });
      if (!previous || previous.payloadHash !== payloadHash) {
        throw new ConflictException("提交标识已使用，请重新提交");
      }
    }
    return { received: true };
  }

  async list(query: DemoRequestListQuery): Promise<DemoRequestPage> {
    const actor = this.principals.current();
    await this.assertListAccess(actor);
    const { page, pageSize } = query;
    const keyword = query.keyword?.trim();
    const where = keyword ? {
      OR: [{ name: { contains: keyword } }, { company: { contains: keyword } }, { contactValue: { contains: keyword } }]
    } : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.demoRequest.count({ where }),
      this.prisma.demoRequest.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, name: true, contactType: true, contactValue: true, company: true, message: true, language: true, createdAt: true }
      })
    ]);
    // 保留原批量 count/findMany 事务。返前另核同一主体，撤权后不返回个人资料。
    await this.assertListAccess(actor);
    return {
      total, page, pageSize,
      items: rows.map((row) => ({
        ...row,
        contactType: row.contactType as DemoContactType,
        language: row.language as "zh" | "en",
        createdAt: row.createdAt.toISOString()
      }))
    };
  }
}
