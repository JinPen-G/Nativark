import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { isEmail } from "class-validator";
import type { DemoContactType, DemoRequestPage, DemoRequestReceipt } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { CreateDemoRequestDto, DemoRequestListQueryDto } from "./demo-request.dto";

@Injectable()
export class DemoRequestService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateDemoRequestDto): Promise<DemoRequestReceipt> {
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
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const previous = await this.prisma.demoRequest.findUnique({
        where: { requestKey: input.requestKey }, select: { payloadHash: true }
      });
      if (!previous || previous.payloadHash !== payloadHash) {
        throw new ConflictException("提交标识已使用，请重新提交");
      }
    }
    return { received: true };
  }

  async list(query: DemoRequestListQueryDto): Promise<DemoRequestPage> {
    const { page, pageSize } = query;
    const keyword = query.keyword?.trim();
    const where: Prisma.DemoRequestWhereInput = keyword ? {
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
