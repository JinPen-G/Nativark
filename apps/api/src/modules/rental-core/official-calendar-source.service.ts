/** 原 Nest 构造入口供给同一公共来源服务和本宿主数据库。 */
import { Injectable } from "@nestjs/common";
import { OfficialCalendarSourceService as PlatformOfficialCalendarSourceService } from "@rental-os/platform-server/official-calendar-source";
import { PrismaService } from "../database/prisma.service";

export * from "@rental-os/platform-server/official-calendar-source";

@Injectable()
export class OfficialCalendarSourceService extends PlatformOfficialCalendarSourceService {
  constructor(prisma: PrismaService) { super(prisma); }
}
