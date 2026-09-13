import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/shared";
import {
  RegisterOfficialCalendarSourceVersionDto,
  SaveOfficialCalendarSourceDto
} from "./rental-config-request.dto";
import { OfficialCalendarSourceService } from "./official-calendar-source.service";

interface AuthenticatedRequest {
  user: SystemUserRow;
}

/**
 * 公共官方日历来源注册表（需求 4.5.8：「SaaS 平台管理员导入和维护公共官方日历来源；
 * 不得直接发布租户经营空间日历或借此查看空间业务数据」）。
 *
 * 挂在 `/platform` 下并由守卫限定只有 SaaS 平台管理员可写：这里的数据是跨租户的
 * 公共基础数据，且**不含任何空间业务数据**，因此平台管理员维护它不违反上面那条边界。
 * 经营空间侧只读引用，走 `/rental/v1/official-calendar-sources`。
 */
@Controller("platform/official-calendars")
export class OfficialCalendarSourceController {
  constructor(private readonly sources: OfficialCalendarSourceService) {}

  @Get() list() {
    return this.sources.listSources();
  }

  @Post() create(@Req() req: AuthenticatedRequest, @Body() body: SaveOfficialCalendarSourceDto) {
    return this.sources.saveSource(body, req.user.displayName);
  }

  @Put(":id") update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: SaveOfficialCalendarSourceDto
  ) {
    return this.sources.saveSource({ ...body, id }, req.user.displayName);
  }

  @Get(":id/versions") versions(@Param("id") id: string, @Query("year") year?: string) {
    return this.sources.listVersions(id, year ? Number(year) : undefined);
  }

  @Post(":id/versions") registerVersion(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: RegisterOfficialCalendarSourceVersionDto
  ) {
    return this.sources.registerVersion(id, body, req.user.displayName);
  }
}
