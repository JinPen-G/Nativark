/** 原组合宿主的演示预约服务注入位置，复用公共单源创建、分页和当前主体复验。 */
import { Injectable } from "@nestjs/common";
import { DemoRequestService as PublicDemoRequestService } from "@rental-os/platform-server/demo-requests";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class DemoRequestService extends PublicDemoRequestService {
  constructor(prisma: PrismaService) { super(prisma); }
}
